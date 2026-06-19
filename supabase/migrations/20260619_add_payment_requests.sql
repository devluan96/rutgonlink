-- Add manual payment requests for plan upgrades.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS payment_requests (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email     TEXT NOT NULL,
  user_name      TEXT,
  plan           TEXT NOT NULL,
  amount         INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'awaiting_payment',
  reference_code TEXT NOT NULL UNIQUE,
  transfer_note  TEXT,
  payer_note     TEXT,
  reviewed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  admin_note     TEXT,
  submitted_at   TIMESTAMPTZ,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON payment_requests(created_at);
