-- Add system domain management.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS domains (
  id          BIGSERIAL PRIMARY KEY,
  hostname    TEXT UNIQUE NOT NULL,
  label       TEXT,
  is_primary  BOOLEAN DEFAULT FALSE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_hostname  ON domains(hostname);
CREATE INDEX IF NOT EXISTS idx_domains_primary   ON domains(is_primary);
CREATE INDEX IF NOT EXISTS idx_domains_is_active ON domains(is_active);
