ALTER TABLE users
  ADD COLUMN IF NOT EXISTS affiliate_shopee_url TEXT,
  ADD COLUMN IF NOT EXISTS affiliate_tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS session_revoked_after TIMESTAMPTZ;
