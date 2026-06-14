-- ═══════════════════════════════════════════════════════════════
--  RutGonLink – Supabase Schema
--  Chạy file này trong Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── Users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT,
  plan       TEXT DEFAULT 'free',
  role       TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Links ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS links (
  id                 BIGSERIAL PRIMARY KEY,
  short_code         TEXT UNIQUE NOT NULL,
  original_url       TEXT NOT NULL,
  alias              TEXT UNIQUE,
  link_type          TEXT DEFAULT 'direct',
  og_title           TEXT,
  og_desc            TEXT,
  og_image           TEXT,
  video_url          TEXT,
  video_overlay_text TEXT,
  user_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  clicks             INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code);
CREATE INDEX IF NOT EXISTS idx_links_alias      ON links(alias);
CREATE INDEX IF NOT EXISTS idx_links_user_id    ON links(user_id);

-- ── Clicks ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clicks (
  id         BIGSERIAL PRIMARY KEY,
  link_id    BIGINT REFERENCES links(id) ON DELETE CASCADE,
  ip         TEXT,
  user_agent TEXT,
  referrer   TEXT,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clicks_link_id    ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);

-- ── Uploads dedup ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  id            BIGSERIAL PRIMARY KEY,
  hash          TEXT UNIQUE NOT NULL,
  url           TEXT NOT NULL,
  thumb         TEXT,
  resource_type TEXT DEFAULT 'video',
  public_id     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_hash ON uploads(hash);

-- ── Function: increment_clicks ───────────────────────────────────
-- Dùng để tăng click counter an toàn (tránh race condition)
CREATE OR REPLACE FUNCTION increment_clicks(link_id BIGINT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE links SET clicks = clicks + 1 WHERE id = link_id;
$$;

-- ── Row Level Security (RLS) ──────────────────────────────────────
-- Tắt RLS vì app dùng service_role key (backend only)
ALTER TABLE users  DISABLE ROW LEVEL SECURITY;
ALTER TABLE links  DISABLE ROW LEVEL SECURITY;
ALTER TABLE clicks DISABLE ROW LEVEL SECURITY;
ALTER TABLE uploads DISABLE ROW LEVEL SECURITY;
