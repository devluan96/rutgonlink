/**
 * database.js – SQLite via sql.js (pure JavaScript, no native build needed)
 * The DB is persisted to disk as a binary file (data/links.db).
 */
const path = require('path');
const fs   = require('fs');

const DB_PATH  = path.join(__dirname, 'data', 'links.db');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// sql.js is loaded async, so we expose an init() that returns a ready db wrapper.
let _db = null;

async function init() {
  if (_db) return _db;

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  // Load existing DB from file, or create new
  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS links (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT UNIQUE NOT NULL,
      original_url TEXT NOT NULL,
      alias      TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      clicks     INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS clicks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id    INTEGER,
      ip         TEXT,
      user_agent TEXT,
      referrer   TEXT,
      clicked_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_short_code ON links(short_code);
    CREATE INDEX IF NOT EXISTS idx_alias ON links(alias);
  `);

  // Persist helper – write DB to disk after every mutating operation
  function persist() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }

  // ── Query helpers ──────────────────────────────────────────────────────
  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows[0] || null;
  }

  function run(sql, params = []) {
    db.run(sql, params);
    persist();
  }

  // ── Public API ─────────────────────────────────────────────────────────
  _db = {
    createLink(shortCode, originalUrl, alias) {
      try {
        run(
          `INSERT INTO links (short_code, original_url, alias) VALUES (?, ?, ?)`,
          [shortCode, originalUrl, alias || null]
        );
        const row = queryOne(`SELECT last_insert_rowid() as id`);
        return { id: row.id, shortCode, originalUrl, alias };
      } catch (err) {
        if (/UNIQUE/.test(err.message)) throw new Error('SHORT_CODE_EXISTS');
        throw err;
      }
    },

    getLinkByCode(shortCode) {
      return queryOne(`SELECT * FROM links WHERE short_code = ?`, [shortCode]);
    },

    getLinkByAlias(alias) {
      if (!alias) return null;
      return queryOne(`SELECT * FROM links WHERE alias = ?`, [alias]);
    },

    getLinkByUrl(url) {
      return queryOne(`SELECT * FROM links WHERE original_url = ?`, [url]);
    },

    recordClick(linkId, ip, userAgent, referrer) {
      db.run(
        `UPDATE links SET clicks = clicks + 1 WHERE id = ?`,
        [linkId]
      );
      db.run(
        `INSERT INTO clicks (link_id, ip, user_agent, referrer) VALUES (?, ?, ?, ?)`,
        [linkId, ip, userAgent, referrer || '']
      );
      persist();
    },

    getRecentLinks() {
      return queryAll(`SELECT * FROM links ORDER BY created_at DESC LIMIT 20`);
    },

    getTotals() {
      const r1 = queryOne(`SELECT COUNT(*) as count FROM links`);
      const r2 = queryOne(`SELECT SUM(clicks) as total FROM links`);
      return {
        totalLinks:  r1 ? r1.count  : 0,
        totalClicks: r2 ? (r2.total || 0) : 0,
      };
    },
  };

  return _db;
}

module.exports = { init };
