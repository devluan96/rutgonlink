CREATE TABLE IF NOT EXISTS support_messages (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sender_role      TEXT NOT NULL DEFAULT 'user',
  message          TEXT NOT NULL,
  is_read_by_user  BOOLEAN NOT NULL DEFAULT FALSE,
  is_read_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_user_id
  ON support_messages(user_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_created_at
  ON support_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_support_messages_sender_role
  ON support_messages(sender_role);

CREATE INDEX IF NOT EXISTS idx_support_messages_admin_unread
  ON support_messages(user_id, is_read_by_admin, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_messages_user_unread
  ON support_messages(user_id, is_read_by_user, created_at DESC);

ALTER TABLE support_messages DISABLE ROW LEVEL SECURITY;
