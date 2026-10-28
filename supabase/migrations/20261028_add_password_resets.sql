-- One-time password reset tokens. Raw tokens are never stored.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE password_reset_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE password_reset_tokens TO service_role;
GRANT USAGE, SELECT ON SEQUENCE password_reset_tokens_id_seq TO service_role;

CREATE OR REPLACE FUNCTION create_password_reset_token(
  p_user_id BIGINT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM password_reset_tokens
    WHERE user_id = p_user_id
      AND created_at > NOW() - INTERVAL '60 seconds'
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE password_reset_tokens
  SET used_at = NOW()
  WHERE user_id = p_user_id AND used_at IS NULL;

  INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, p_expires_at);

  DELETE FROM password_reset_tokens
  WHERE expires_at < NOW() - INTERVAL '7 days';

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION consume_password_reset_token(
  p_token_hash TEXT,
  p_password_hash TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_id BIGINT;
  v_user_id BIGINT;
BEGIN
  SELECT id, user_id
  INTO v_token_id, v_user_id
  FROM password_reset_tokens
  WHERE token_hash = p_token_hash
    AND used_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF v_token_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE users
  SET password = p_password_hash,
      session_revoked_after = NOW()
  WHERE id = v_user_id;

  UPDATE password_reset_tokens
  SET used_at = NOW()
  WHERE user_id = v_user_id AND used_at IS NULL;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION create_password_reset_token(BIGINT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION consume_password_reset_token(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_password_reset_token(BIGINT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION consume_password_reset_token(TEXT, TEXT)
  TO service_role;
