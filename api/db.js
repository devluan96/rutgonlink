const { createClient } = require('@libsql/client/http');

let _client = null;

function getClient() {
  if (_client) return _client;
  let url     = process.env.TURSO_DATABASE_URL || '';
  const token = process.env.TURSO_AUTH_TOKEN   || '';
  if (!url) throw new Error('TURSO_DATABASE_URL chưa được set');
  url = url.replace(/^libsql:\/\//, 'https://');
  console.log('[db] connecting:', url.substring(0, 50));
  _client = createClient({ url, authToken: token });
  return _client;
}

async function init() {
  const c = getClient();

  // Run each DDL separately, ignore "already exists" errors for migrations
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      name       TEXT,
      plan       TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS links (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code   TEXT UNIQUE NOT NULL,
      original_url TEXT NOT NULL,
      alias        TEXT UNIQUE,
      og_title     TEXT,
      og_desc      TEXT,
      og_image     TEXT,
      user_id      INTEGER,
      created_at   TEXT DEFAULT (datetime('now')),
      clicks       INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS clicks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id    INTEGER,
      ip         TEXT,
      user_agent TEXT,
      referrer   TEXT,
      clicked_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_short_code ON links(short_code)`,
    `CREATE INDEX IF NOT EXISTS idx_alias      ON links(alias)`,
    `CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id)`,
    // Migrations for existing DBs – ignore "already exists/duplicate column" errors
    `ALTER TABLE links ADD COLUMN og_title  TEXT`,
    `ALTER TABLE links ADD COLUMN og_desc   TEXT`,
    `ALTER TABLE links ADD COLUMN og_image  TEXT`,
    `ALTER TABLE links ADD COLUMN user_id   INTEGER`,
    // users table migration (in case DB was created before this table)
    `CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      name       TEXT,
      plan       TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of ddl) {
    try { await c.execute({ sql, args: [] }); }
    catch (e) {
      // Ignore: table/index already exists, duplicate column, or column already added
      if (/already exists|duplicate column|SQL_INPUT_ERROR|no such column/i.test(e.message) ||
          e.code === 'SQL_INPUT_ERROR') continue;
      throw e;
    }
  }

  const ex = (sql, args=[]) => c.execute({ sql, args });
  const one = async (sql, args=[]) => { const r = await ex(sql,args); return r.rows[0]||null; };
  const all = async (sql, args=[]) => { const r = await ex(sql,args); return r.rows; };

  return {
    // ── Users ──────────────────────────────────────────────────────
    async createUser(email, hashedPwd, name) {
      try {
        await ex(`INSERT INTO users (email,password,name) VALUES (?,?,?)`, [email,hashedPwd,name||null]);
        return await this.getUserByEmail(email);
      } catch(e) {
        if (/UNIQUE/.test(e.message)) throw new Error('EMAIL_EXISTS');
        throw e;
      }
    },
    async getUserByEmail(email) { return one(`SELECT * FROM users WHERE email=?`,[email]); },
    async getUserById(id)       { return one(`SELECT * FROM users WHERE id=?`,[id]); },
    async updateUserPlan(userId,plan) { await ex(`UPDATE users SET plan=? WHERE id=?`,[plan,userId]); },

    // ── Links ──────────────────────────────────────────────────────
    async createLink(shortCode, originalUrl, alias, ogTitle, ogDesc, ogImage, userId) {
      try {
        await ex(
          `INSERT INTO links (short_code,original_url,alias,og_title,og_desc,og_image,user_id) VALUES (?,?,?,?,?,?,?)`,
          [shortCode, originalUrl, alias||null, ogTitle||null, ogDesc||null, ogImage||null, userId||null]
        );
        const r = await one(`SELECT last_insert_rowid() as id`);
        return { id: r.id, shortCode, originalUrl, alias };
      } catch(e) {
        if (/UNIQUE/.test(e.message)) throw new Error('SHORT_CODE_EXISTS');
        throw e;
      }
    },
    async getLinkByCode(code)  { return one(`SELECT * FROM links WHERE short_code=?`,[code]); },
    async getLinkByAlias(alias){ if(!alias) return null; return one(`SELECT * FROM links WHERE alias=?`,[alias]); },
    async getLinkByUrl(url)    { return one(`SELECT * FROM links WHERE original_url=?`,[url]); },
    async recordClick(linkId, ip, ua, ref) {
      await ex(`UPDATE links SET clicks=clicks+1 WHERE id=?`,[linkId]);
      await ex(`INSERT INTO clicks (link_id,ip,user_agent,referrer) VALUES (?,?,?,?)`,[linkId,ip||'',ua||'',ref||'']);
    },
    async getRecentLinks(userId) {
      if (userId) return all(`SELECT * FROM links WHERE user_id=? ORDER BY created_at DESC LIMIT 50`,[userId]);
      return all(`SELECT * FROM links ORDER BY created_at DESC LIMIT 20`);
    },
    async getTotals(userId) {
      const where = userId ? `WHERE user_id=${Number(userId)}` : '';
      const r1 = await one(`SELECT COUNT(*) as c FROM links ${where}`);
      const r2 = await one(`SELECT SUM(clicks) as t FROM links ${where}`);
      return { totalLinks: Number(r1?.c||0), totalClicks: Number(r2?.t||0) };
    },
    async countTodayLinks(userId) {
      const where = userId ? `AND user_id=${Number(userId)}` : `AND user_id IS NULL`;
      const r = await one(`SELECT COUNT(*) as c FROM links WHERE date(created_at)=date('now') ${where}`);
      return Number(r?.c||0);
    },
  };
}

module.exports = { init };
