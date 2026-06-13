/**
 * db.js – Turso (libsql/http) client
 * Env vars:
 *   TURSO_DATABASE_URL  – libsql://your-db.turso.io
 *   TURSO_AUTH_TOKEN    – token từ Turso dashboard
 */
const { createClient } = require('@libsql/client/http');

let _client = null;

function getClient() {
  if (_client) return _client;
  let url     = process.env.TURSO_DATABASE_URL || '';
  const token = process.env.TURSO_AUTH_TOKEN   || '';
  if (!url) throw new Error('TURSO_DATABASE_URL chưa được set');
  url = url.replace(/^libsql:\/\//, 'https://');
  console.log('[db] connecting to:', url.substring(0, 50));
  _client = createClient({ url, authToken: token });
  return _client;
}

async function init() {
  const client = getClient();

  const ddl = [
    `CREATE TABLE IF NOT EXISTS links (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code   TEXT UNIQUE NOT NULL,
      original_url TEXT NOT NULL,
      alias        TEXT UNIQUE,
      og_title     TEXT,
      og_desc      TEXT,
      og_image     TEXT,
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
    // Migration: thêm cột OG nếu DB cũ chưa có
    `ALTER TABLE links ADD COLUMN og_title TEXT`,
    `ALTER TABLE links ADD COLUMN og_desc  TEXT`,
    `ALTER TABLE links ADD COLUMN og_image TEXT`,
  ];

  for (const sql of ddl) {
    try {
      await client.execute({ sql, args: [] });
    } catch (e) {
      // Bỏ qua lỗi "column already exists" khi migration
      if (!/already exists|duplicate column/i.test(e.message)) throw e;
    }
  }

  return {
    async createLink(shortCode, originalUrl, alias, ogTitle, ogDesc, ogImage) {
      try {
        await client.execute({
          sql:  `INSERT INTO links (short_code, original_url, alias, og_title, og_desc, og_image)
                 VALUES (?, ?, ?, ?, ?, ?)`,
          args: [shortCode, originalUrl, alias || null, ogTitle || null, ogDesc || null, ogImage || null],
        });
        const r = await client.execute({ sql: `SELECT last_insert_rowid() as id`, args: [] });
        return { id: r.rows[0].id, shortCode, originalUrl, alias };
      } catch (err) {
        if (/UNIQUE/.test(err.message)) throw new Error('SHORT_CODE_EXISTS');
        throw err;
      }
    },

    async getLinkByCode(code) {
      const r = await client.execute({ sql: `SELECT * FROM links WHERE short_code = ?`, args: [code] });
      return r.rows[0] || null;
    },

    async getLinkByAlias(alias) {
      if (!alias) return null;
      const r = await client.execute({ sql: `SELECT * FROM links WHERE alias = ?`, args: [alias] });
      return r.rows[0] || null;
    },

    async getLinkByUrl(url) {
      const r = await client.execute({ sql: `SELECT * FROM links WHERE original_url = ?`, args: [url] });
      return r.rows[0] || null;
    },

    async recordClick(linkId, ip, userAgent, referrer) {
      await client.execute({ sql: `UPDATE links SET clicks = clicks + 1 WHERE id = ?`, args: [linkId] });
      await client.execute({
        sql:  `INSERT INTO clicks (link_id, ip, user_agent, referrer) VALUES (?, ?, ?, ?)`,
        args: [linkId, ip || '', userAgent || '', referrer || ''],
      });
    },

    async getRecentLinks() {
      const r = await client.execute({ sql: `SELECT * FROM links ORDER BY created_at DESC LIMIT 20`, args: [] });
      return r.rows;
    },

    async getTotals() {
      const r1 = await client.execute({ sql: `SELECT COUNT(*) as count FROM links`, args: [] });
      const r2 = await client.execute({ sql: `SELECT SUM(clicks) as total FROM links`, args: [] });
      return {
        totalLinks:  Number(r1.rows[0]?.count || 0),
        totalClicks: Number(r2.rows[0]?.total || 0),
      };
    },
  };
}

module.exports = { init };
