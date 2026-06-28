CREATE TABLE IF NOT EXISTS article_funnels (
  id                 BIGSERIAL PRIMARY KEY,
  route_slug         TEXT UNIQUE NOT NULL,
  domain_hostname    TEXT,
  title              TEXT,
  config_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_funnels_domain_hostname
  ON article_funnels(domain_hostname);

CREATE INDEX IF NOT EXISTS idx_article_funnels_created_by_user_id
  ON article_funnels(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_article_funnels_created_at
  ON article_funnels(created_at DESC);
