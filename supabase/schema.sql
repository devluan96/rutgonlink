-- ============================================================================
--  BocLink - Supabase Schema
--  Chay file nay trong Supabase SQL Editor
-- ============================================================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT,
  phone      TEXT,
  avatar_url TEXT,
  plan       TEXT DEFAULT 'free',
  role       TEXT DEFAULT 'user',
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_pending_secret TEXT,
  two_factor_enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id            BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id);

-- Workspace members
CREATE TABLE IF NOT EXISTS workspace_members (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  display_name TEXT,
  role         TEXT DEFAULT 'editor',
  status       TEXT DEFAULT 'pending',
  invited_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_workspace_email ON workspace_members(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_status ON workspace_members(status);

-- Links
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
  domain_hostname    TEXT,
  workspace_id       BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
  template_id        BIGINT,
  created_from_template BOOLEAN DEFAULT FALSE,
  user_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  guest_session_id   TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  clicks             INTEGER DEFAULT 0
);

ALTER TABLE links ADD COLUMN IF NOT EXISTS guest_session_id TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS domain_hostname TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS template_id BIGINT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS created_from_template BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code);
CREATE INDEX IF NOT EXISTS idx_links_alias ON links(alias);
CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
CREATE INDEX IF NOT EXISTS idx_links_guest_session_id ON links(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_links_domain_hostname ON links(domain_hostname);
CREATE INDEX IF NOT EXISTS idx_links_workspace_id ON links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_links_template_id ON links(template_id);

-- Workspace link templates
CREATE TABLE IF NOT EXISTS workspace_link_templates (
  id                 BIGSERIAL PRIMARY KEY,
  workspace_id       BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source_link_id     BIGINT REFERENCES links(id) ON DELETE SET NULL,
  name               TEXT NOT NULL,
  og_title           TEXT,
  og_desc            TEXT,
  og_image           TEXT,
  link_type          TEXT DEFAULT 'direct',
  video_url          TEXT,
  video_overlay_text TEXT,
  domain_hostname    TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_workspace_id ON workspace_link_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_created_by ON workspace_link_templates(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_source_link_id ON workspace_link_templates(source_link_id);

-- Clicks
CREATE TABLE IF NOT EXISTS clicks (
  id           BIGSERIAL PRIMARY KEY,
  link_id      BIGINT REFERENCES links(id) ON DELETE CASCADE,
  ip           TEXT,
  user_agent   TEXT,
  referrer     TEXT,
  country_code TEXT,
  country_name TEXT,
  city         TEXT,
  clicked_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clicks ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS country_name TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS city TEXT;

CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_clicks_country_code ON clicks(country_code);

-- Domains
CREATE TABLE IF NOT EXISTS domains (
  id                  BIGSERIAL PRIMARY KEY,
  hostname            TEXT UNIQUE NOT NULL,
  label               TEXT,
  is_primary          BOOLEAN DEFAULT FALSE,
  is_active           BOOLEAN DEFAULT TRUE,
  verification_status TEXT DEFAULT 'verified',
  expires_at          DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE domains ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'verified';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS expires_at DATE;

CREATE INDEX IF NOT EXISTS idx_domains_hostname ON domains(hostname);
CREATE INDEX IF NOT EXISTS idx_domains_primary ON domains(is_primary);
CREATE INDEX IF NOT EXISTS idx_domains_is_active ON domains(is_active);
CREATE INDEX IF NOT EXISTS idx_domains_verify ON domains(verification_status);
CREATE INDEX IF NOT EXISTS idx_domains_expiry ON domains(expires_at);

-- Login events
CREATE TABLE IF NOT EXISTS login_events (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_label       TEXT,
  browser_name       TEXT,
  os_name            TEXT,
  device_type        TEXT,
  ip                 TEXT,
  user_agent         TEXT,
  country_code       TEXT,
  country_name       TEXT,
  city               TEXT,
  is_new_device      BOOLEAN DEFAULT FALSE,
  occurred_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_occurred_at ON login_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_login_events_fingerprint ON login_events(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_login_events_country_code ON login_events(country_code);

-- Billing requests
CREATE TABLE IF NOT EXISTS payment_requests (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  user_name     TEXT,
  plan          TEXT NOT NULL,
  amount        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'awaiting_payment',
  reference_code TEXT NOT NULL UNIQUE,
  transfer_note TEXT,
  payer_note    TEXT,
  reviewed_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  admin_note    TEXT,
  submitted_at  TIMESTAMPTZ,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON payment_requests(created_at);

-- Uploads dedup
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

-- Bio profiles
CREATE TABLE IF NOT EXISTS bio_profiles (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT,
  subtitle     TEXT,
  avatar       TEXT,
  accent       TEXT DEFAULT '#3b82f6',
  link_count   INTEGER DEFAULT 5,
  link_source  TEXT DEFAULT 'recent',
  is_published BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bio_profiles_slug ON bio_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_bio_profiles_user_id ON bio_profiles(user_id);

-- Function: increment_clicks
CREATE OR REPLACE FUNCTION increment_clicks(link_id BIGINT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE links SET clicks = clicks + 1 WHERE id = link_id;
$$;

-- Row Level Security
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE links DISABLE ROW LEVEL SECURITY;
ALTER TABLE clicks DISABLE ROW LEVEL SECURITY;
ALTER TABLE domains DISABLE ROW LEVEL SECURITY;
ALTER TABLE login_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE uploads DISABLE ROW LEVEL SECURITY;
ALTER TABLE bio_profiles DISABLE ROW LEVEL SECURITY;
