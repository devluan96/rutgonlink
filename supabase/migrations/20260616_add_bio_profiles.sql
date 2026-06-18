-- Add bio profile storage for public shareable pages.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS bio_profiles (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT,
  subtitle      TEXT,
  avatar        TEXT,
  accent        TEXT DEFAULT '#3b82f6',
  link_count    INTEGER DEFAULT 5,
  link_source   TEXT DEFAULT 'recent',
  is_published  BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bio_profiles_slug ON bio_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_bio_profiles_user_id ON bio_profiles(user_id);
