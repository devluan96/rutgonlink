CREATE TABLE IF NOT EXISTS article_funnel_labs (
  id                   BIGSERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  title                TEXT,
  config_json          JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_route_slug TEXT,
  created_by_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_funnel_labs_created_by_user_id
  ON article_funnel_labs(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_article_funnel_labs_updated_at
  ON article_funnel_labs(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_funnel_labs_published_route_slug
  ON article_funnel_labs(published_route_slug);
