CREATE TABLE IF NOT EXISTS redirect_logs (
  id           BIGSERIAL PRIMARY KEY,
  event        TEXT NOT NULL DEFAULT 'shortlink_redirect',
  request_id   TEXT,
  link_id      BIGINT REFERENCES links(id) ON DELETE SET NULL,
  code         TEXT,
  mode         TEXT,
  platform     TEXT,
  ua_kind      TEXT,
  status       INTEGER,
  target       TEXT,
  referer_host TEXT,
  meta_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redirect_logs_occurred_at
  ON redirect_logs(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_redirect_logs_code
  ON redirect_logs(code);

CREATE INDEX IF NOT EXISTS idx_redirect_logs_status
  ON redirect_logs(status);

CREATE INDEX IF NOT EXISTS idx_redirect_logs_link_id
  ON redirect_logs(link_id);
