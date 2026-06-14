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

  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      name       TEXT,
      plan       TEXT DEFAULT 'free',
      role       TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS links (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code   TEXT UNIQUE NOT NULL,
      original_url TEXT NOT NULL,
      alias        TEXT UNIQUE,
      link_type    TEXT DEFAULT 'direct',
      og_title     TEXT,
      og_desc      TEXT,
      og_image     TEXT,
      video_url    TEXT,
      video_overlay_text TEXT,
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
    // Migrations – ignored if column/table already exists
    `ALTER TABLE links ADD COLUMN og_title  TEXT`,
    `ALTER TABLE links ADD COLUMN og_desc   TEXT`,
    `ALTER TABLE links ADD COLUMN og_image  TEXT`,
    `ALTER TABLE links ADD COLUMN user_id   INTEGER`,
    `ALTER TABLE links ADD COLUMN link_type TEXT DEFAULT 'direct'`,
    `ALTER TABLE links ADD COLUMN video_url TEXT`,
    `ALTER TABLE links ADD COLUMN video_overlay_text TEXT`,
    `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`,
    // Uploads dedup table
    `CREATE TABLE IF NOT EXISTS uploads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hash          TEXT UNIQUE NOT NULL,
      url           TEXT NOT NULL,
      thumb         TEXT,
      resource_type TEXT DEFAULT 'video',
      public_id     TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_uploads_hash ON uploads(hash)`,
  ];

  for (const sql of ddl) {
    try { await c.execute({ sql, args: [] }); }
    catch (e) {
      if (e.code === 'SQL_INPUT_ERROR' ||
          /already exists|duplicate column|no such column/i.test(e.message)) continue;
      throw e;
    }
  }

  const ex  = (sql, args=[]) => c.execute({ sql, args });
  const one = async (sql, args=[]) => { const r = await ex(sql,args); return r.rows[0]||null; };
  const all = async (sql, args=[]) => { const r = await ex(sql,args); return r.rows; };

  return {
    // ── Users ──────────────────────────────────────────────────────────
    async createUser(email, hashedPwd, name, role='user') {
      try {
        await ex(`INSERT INTO users (email,password,name,role) VALUES (?,?,?,?)`,
          [email, hashedPwd, name||null, role]);
        return await this.getUserByEmail(email);
      } catch(e) {
        if (/UNIQUE/.test(e.message)) throw new Error('EMAIL_EXISTS');
        throw e;
      }
    },
    async getUserByEmail(email) { return one(`SELECT * FROM users WHERE email=?`,[email]); },
    async getUserById(id)       { return one(`SELECT * FROM users WHERE id=?`,[id]); },
    async updateUserPlan(userId, plan) {
      await ex(`UPDATE users SET plan=? WHERE id=?`,[plan, userId]);
    },
    async updateUserRole(userId, role) {
      await ex(`UPDATE users SET role=? WHERE id=?`,[role, userId]);
    },
    async deleteUser(userId) {
      await ex(`DELETE FROM users WHERE id=?`,[userId]);
    },
    async getAllUsers() {
      return all(`SELECT id,email,name,plan,role,created_at FROM users ORDER BY created_at DESC`);
    },
    async countUsers() {
      const r = await one(`SELECT COUNT(*) as c FROM users`);
      return Number(r?.c||0);
    },

    // ── Links ──────────────────────────────────────────────────────────
    async createLink(shortCode, originalUrl, alias, ogTitle, ogDesc, ogImage, userId, linkType, videoUrl, videoOverlayText) {
      try {
        await ex(
          `INSERT INTO links (short_code,original_url,alias,og_title,og_desc,og_image,user_id,link_type,video_url,video_overlay_text)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [shortCode, originalUrl, alias||null, ogTitle||null, ogDesc||null, ogImage||null,
           userId||null, linkType||'direct', videoUrl||null, videoOverlayText||null]
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
      await ex(`INSERT INTO clicks (link_id,ip,user_agent,referrer) VALUES (?,?,?,?)`,
        [linkId, ip||'', ua||'', ref||'']);
    },
    async getRecentLinks(userId) {
      if (userId) return all(`SELECT * FROM links WHERE user_id=? ORDER BY created_at DESC LIMIT 100`,[userId]);
      return all(`SELECT * FROM links ORDER BY created_at DESC LIMIT 20`);
    },
    async getAllLinks() {
      return all(`SELECT l.*,u.email as owner_email FROM links l LEFT JOIN users u ON l.user_id=u.id ORDER BY l.created_at DESC LIMIT 200`);
    },
    async deleteLink(linkId) {
      await ex(`DELETE FROM links WHERE id=?`,[linkId]);
    },
    async updateLink(linkId, fields) {
      // fields: { original_url, alias, og_title, og_desc, og_image, link_type, video_url, video_overlay_text }
      const allowed = ['original_url','alias','og_title','og_desc','og_image',
                       'link_type','video_url','video_overlay_text'];
      const sets = [];
      const args = [];
      for (const [k,v] of Object.entries(fields)) {
        if (allowed.includes(k)) { sets.push(`${k}=?`); args.push(v ?? null); }
      }
      if (!sets.length) return;
      args.push(linkId);
      await ex(`UPDATE links SET ${sets.join(',')} WHERE id=?`, args);
    },
    async getLinkById(id) {
      return one(`SELECT * FROM links WHERE id=?`,[id]);
    },
    async getTotals(userId) {
      const where = userId ? `WHERE user_id=${Number(userId)}` : '';
      const r1 = await one(`SELECT COUNT(*) as c FROM links ${where}`);
      const r2 = await one(`SELECT SUM(clicks) as t FROM links ${where}`);
      return { totalLinks: Number(r1?.c||0), totalClicks: Number(r2?.t||0) };
    },
    async getAdminTotals() {
      const r1 = await one(`SELECT COUNT(*) as c FROM links`);
      const r2 = await one(`SELECT SUM(clicks) as t FROM links`);
      const r3 = await one(`SELECT COUNT(*) as c FROM users`);
      return {
        totalLinks:  Number(r1?.c||0),
        totalClicks: Number(r2?.t||0),
        totalUsers:  Number(r3?.c||0),
      };
    },
    async countTodayLinks(userId) {
      const where = userId ? `AND user_id=${Number(userId)}` : `AND user_id IS NULL`;
      const r = await one(`SELECT COUNT(*) as c FROM links WHERE date(created_at)=date('now') ${where}`);
      return Number(r?.c||0);
    },
    async getTodayStats(userId) {
      const wToday = userId
        ? `WHERE date(created_at)=date('now') AND user_id=${Number(userId)}`
        : `WHERE date(created_at)=date('now')`;
      const r1 = await one(`SELECT COUNT(*) as c FROM links ${wToday}`);
      const whereClicks = userId
        ? `WHERE date(c.clicked_at)=date('now') AND l.user_id=${Number(userId)}`
        : `WHERE date(c.clicked_at)=date('now')`;
      const r2 = await one(
        `SELECT COUNT(*) as c FROM clicks c JOIN links l ON c.link_id=l.id ${whereClicks}`
      );
      return { linksToday: Number(r1?.c||0), clicksToday: Number(r2?.c||0) };
    },
    // ── Upload dedup ────────────────────────────────────────────────────────
    async getUploadByHash(hash) {
      return one(`SELECT * FROM uploads WHERE hash=?`, [hash]);
    },
    async saveUpload(hash, url, thumb, resource_type, public_id) {
      try {
        await ex(
          `INSERT INTO uploads (hash,url,thumb,resource_type,public_id) VALUES (?,?,?,?,?)`,
          [hash, url, thumb||null, resource_type||'video', public_id||null]
        );
      } catch(e) {
        if (!/UNIQUE/i.test(e.message)) throw e;
      }
    },
    // ── Delete link ─────────────────────────────────────────────────────────
    async updateLink(linkId, fields) {
      const allowed = ['original_url','alias','og_title','og_desc','og_image',
                       'link_type','video_url','video_overlay_text'];
      const sets = [], args = [];
      for (const [k,v] of Object.entries(fields)) {
        if (allowed.includes(k)) { sets.push(`${k}=?`); args.push(v??null); }
      }
      if (!sets.length) return;
      args.push(linkId);
      await ex(`UPDATE links SET ${sets.join(',')} WHERE id=?`, args);
    },
    async getLinkById(id) {
      return one(`SELECT * FROM links WHERE id=?`, [id]);
    },
  };
}

module.exports = { init };
