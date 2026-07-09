ALTER TABLE article_funnels
  ADD COLUMN IF NOT EXISTS affiliate_clicks INTEGER NOT NULL DEFAULT 0;

ALTER TABLE article_funnel_labs
  ADD COLUMN IF NOT EXISTS affiliate_clicks INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS article_funnel_clicks (
  id                BIGSERIAL PRIMARY KEY,
  article_funnel_id BIGINT REFERENCES article_funnels(id) ON DELETE SET NULL,
  route_slug        TEXT NOT NULL,
  stage_key         TEXT NOT NULL,
  ip                TEXT,
  user_agent        TEXT,
  referrer          TEXT,
  country_code      TEXT,
  country_name      TEXT,
  city              TEXT,
  clicked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_funnel_clicks_route_slug
  ON article_funnel_clicks(route_slug);

CREATE INDEX IF NOT EXISTS idx_article_funnel_clicks_stage_key
  ON article_funnel_clicks(stage_key);

CREATE INDEX IF NOT EXISTS idx_article_funnel_clicks_clicked_at
  ON article_funnel_clicks(clicked_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_funnel_clicks_route_stage_clicked_at
  ON article_funnel_clicks(route_slug, stage_key, clicked_at DESC);

CREATE OR REPLACE FUNCTION increment_article_funnel_affiliate_clicks(p_route_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  next_clicks INTEGER := 0;
BEGIN
  UPDATE article_funnels
  SET affiliate_clicks = COALESCE(affiliate_clicks, 0) + 1,
      updated_at = NOW()
  WHERE route_slug = p_route_slug
  RETURNING affiliate_clicks INTO next_clicks;

  IF next_clicks > 0 THEN
    UPDATE article_funnel_labs
    SET affiliate_clicks = next_clicks
    WHERE published_route_slug = p_route_slug;
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'route_slug', p_route_slug,
    'affiliate_clicks', next_clicks
  );
END;
$$;
