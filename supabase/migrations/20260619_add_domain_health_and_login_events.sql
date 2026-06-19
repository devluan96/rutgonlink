-- Add domain health metadata and login event tracking.
-- Safe to run multiple times.

ALTER TABLE domains
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'verified';

ALTER TABLE domains
  ADD COLUMN IF NOT EXISTS expires_at DATE;

UPDATE domains
SET verification_status = COALESCE(NULLIF(TRIM(verification_status), ''), 'verified')
WHERE verification_status IS NULL
   OR TRIM(COALESCE(verification_status, '')) = '';

CREATE INDEX IF NOT EXISTS idx_domains_verify ON domains(verification_status);
CREATE INDEX IF NOT EXISTS idx_domains_expiry ON domains(expires_at);

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
  is_new_device      BOOLEAN DEFAULT FALSE,
  occurred_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_occurred_at ON login_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_login_events_fingerprint ON login_events(device_fingerprint);
