/**
 * db.js – Turso (libsql) client
 * Env vars cần có:
 *   TURSO_DATABASE_URL  – dạng libsql://your-db.turso.io
 *   TURSO_AUTH_TOKEN    – token từ Turso dashboard
 *
 * Khi chạy local (dev) có thể dùng SQLite file bằng cách set:
 *   TURSO_DATABASE_URL=file:data/links.db
 *   TURSO_AUTH_TOKEN=  (để trống)
 */
const { createClient } = require('@libsql/client');

let _client = null;

function getClient() {
  if (_client) return _client;

  const url   = process.env.TURSO_DATABASE_URL || 'file:data/links.db';
  const token = process.env.TURSO_AUTH_TOKEN   || '';

  console.log('[db] connecting to:', url.substring(0, 40) + '...');

  _client = createClient({ url, authToken: token });
  return _client;
}

async function init() {
  const client = getClient();

  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS links (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code   TEXT UNIQUE NOT NULL,
      original_url TEXT NOT NULL,
      alias        TEXT UNIQUE,
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
  ];

  for (const sql of ddlStatements) {
    await client.execute({ sql, args: [] });
  }

  return {
    async createLink(shortCode, originalUrl, alias) {
      try {
        await client.execute({
          sql: `INSERT INTO links (short_code, original_url, alias) VALUES (?, ?, ?)`,
          args: [shortCode, originalUrl, alias || null],
        });
        const r = await client.execute({ sql: `SELECT last_insert_rowid() as id`, args: [] });
        return { id: r.rows[0].id, shortCode, originalUrl, alias };
      } catch (err) {
        if (/UNIQUE/.test(err.message)) throw new Error('SHORT_CODE_EXISTS');
        throw err;
      }
    },

    async getLinkByCode(shortCode) {
      const r = await client.execute({
        sql:  `SELECT * FROM links WHERE short_code = ?`,
        args: [shortCode],
      });
      return r.rows[0] || null;
    },

    async getLinkByAlias(alias) {
      if (!alias) return null;
      const r = await client.execute({
        sql:  `SELECT * FROM links WHERE alias = ?`,
        args: [alias],
      });
      return r.rows[0] || null;
    },

    async getLinkByUrl(url) {
      const r = await client.execute({
        sql:  `SELECT * FROM links WHERE original_url = ?`,
        args: [url],
      });
      return r.rows[0] || null;
    },

    async recordClick(linkId, ip, userAgent, referrer) {
      await client.execute({
        sql:  `UPDATE links SET clicks = clicks + 1 WHERE id = ?`,
        args: [linkId],
      });
      await client.execute({
        sql:  `INSERT INTO clicks (link_id, ip, user_agent, referrer) VALUES (?, ?, ?, ?)`,
        args: [linkId, ip || '', userAgent || '', referrer || ''],
      });
    },

    async getRecentLinks() {
      const r = await client.execute({
        sql:  `SELECT * FROM links ORDER BY created_at DESC LIMIT 20`,
        args: [],
      });
      return r.rows;
    },

    async getTotals() {
      const r1 = await client.execute({ sql: `SELECT COUNT(*) as count FROM links`, args: [] });
      const r2 = await client.execute({ sql: `SELECT SUM(clicks) as total FROM links`, args: [] });
      return {
        totalLinks:  Number(r1.rows[0]?.count  || 0),
        totalClicks: Number(r2.rows[0]?.total  || 0),
      };
    },
  };
}

module.exports = { init };
