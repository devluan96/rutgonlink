-- Add account profile fields and 2FA columns to users.
-- Safe to run multiple times.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;

UPDATE users
SET two_factor_enabled = COALESCE(two_factor_enabled, FALSE)
WHERE two_factor_enabled IS NULL;
