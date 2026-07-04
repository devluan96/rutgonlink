-- ============================================================================
--  BocLink - Supabase Schema
--  Chay file nay trong Supabase SQL Editor
-- ============================================================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  name       TEXT,
  phone      TEXT,
  avatar_url TEXT,
  affiliate_shopee_url TEXT,
  affiliate_tiktok_url TEXT,
  plan       TEXT DEFAULT 'free',
  role       TEXT DEFAULT 'user',
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_pending_secret TEXT,
  two_factor_enabled_at TIMESTAMPTZ,
  session_revoked_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_shopee_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_tiktok_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_revoked_after TIMESTAMPTZ;

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id            BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id);

-- Workspace members
CREATE TABLE IF NOT EXISTS workspace_members (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  email        TEXT NOT NULL,
  display_name TEXT,
  role         TEXT DEFAULT 'editor',
  status       TEXT DEFAULT 'pending',
  invited_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_workspace_email ON workspace_members(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_status ON workspace_members(status);

-- Links
CREATE TABLE IF NOT EXISTS links (
  id                 BIGSERIAL PRIMARY KEY,
  short_code         TEXT UNIQUE NOT NULL,
  original_url       TEXT NOT NULL,
  alias              TEXT UNIQUE,
  link_type          TEXT DEFAULT 'direct',
  og_title           TEXT,
  og_desc            TEXT,
  og_image           TEXT,
  video_url          TEXT,
  video_overlay_text TEXT,
  domain_hostname    TEXT,
  workspace_id       BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
  template_id        BIGINT,
  created_from_template BOOLEAN DEFAULT FALSE,
  user_id            BIGINT REFERENCES users(id) ON DELETE SET NULL,
  guest_session_id   TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  clicks             INTEGER DEFAULT 0
);

ALTER TABLE links ADD COLUMN IF NOT EXISTS guest_session_id TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS domain_hostname TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS template_id BIGINT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS created_from_template BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code);
CREATE INDEX IF NOT EXISTS idx_links_alias ON links(alias);
CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
CREATE INDEX IF NOT EXISTS idx_links_user_id_created_at ON links(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_guest_session_id ON links(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_links_guest_session_id_created_at ON links(guest_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_domain_hostname ON links(domain_hostname);
CREATE INDEX IF NOT EXISTS idx_links_workspace_id ON links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_links_template_id ON links(template_id);

-- Workspace link templates
CREATE TABLE IF NOT EXISTS workspace_link_templates (
  id                 BIGSERIAL PRIMARY KEY,
  workspace_id       BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source_link_id     BIGINT REFERENCES links(id) ON DELETE SET NULL,
  media_link_id      BIGINT REFERENCES links(id) ON DELETE SET NULL,
  source_link_ids_json JSONB DEFAULT '[]'::jsonb,
  name               TEXT NOT NULL,
  og_title           TEXT,
  og_desc            TEXT,
  og_image           TEXT,
  link_type          TEXT DEFAULT 'direct',
  video_url          TEXT,
  video_overlay_text TEXT,
  domain_hostname    TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_workspace_id ON workspace_link_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_created_by ON workspace_link_templates(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_source_link_id ON workspace_link_templates(source_link_id);
CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_media_link_id ON workspace_link_templates(media_link_id);

-- Article funnel publishes
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

CREATE INDEX IF NOT EXISTS idx_article_funnels_domain_hostname ON article_funnels(domain_hostname);
CREATE INDEX IF NOT EXISTS idx_article_funnels_created_by_user_id ON article_funnels(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_article_funnels_created_at ON article_funnels(created_at DESC);

-- Clicks
CREATE TABLE IF NOT EXISTS clicks (
  id           BIGSERIAL PRIMARY KEY,
  link_id      BIGINT REFERENCES links(id) ON DELETE CASCADE,
  ip           TEXT,
  user_agent   TEXT,
  referrer     TEXT,
  country_code TEXT,
  country_name TEXT,
  city         TEXT,
  clicked_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clicks ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS country_name TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS city TEXT;

CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_clicks_link_id_clicked_at ON clicks(link_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_clicks_country_code ON clicks(country_code);

-- Domains
CREATE TABLE IF NOT EXISTS domains (
  id                  BIGSERIAL PRIMARY KEY,
  hostname            TEXT UNIQUE NOT NULL,
  label               TEXT,
  is_primary          BOOLEAN DEFAULT FALSE,
  is_active           BOOLEAN DEFAULT TRUE,
  verification_status TEXT DEFAULT 'verified',
  expires_at          DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE domains ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'verified';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS expires_at DATE;

CREATE INDEX IF NOT EXISTS idx_domains_hostname ON domains(hostname);
CREATE INDEX IF NOT EXISTS idx_domains_primary ON domains(is_primary);
CREATE INDEX IF NOT EXISTS idx_domains_is_active ON domains(is_active);
CREATE INDEX IF NOT EXISTS idx_domains_verify ON domains(verification_status);
CREATE INDEX IF NOT EXISTS idx_domains_expiry ON domains(expires_at);

-- Login events
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
  country_code       TEXT,
  country_name       TEXT,
  city               TEXT,
  is_new_device      BOOLEAN DEFAULT FALSE,
  occurred_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user_id ON login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_occurred_at ON login_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_login_events_fingerprint ON login_events(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_login_events_country_code ON login_events(country_code);

-- Billing requests
CREATE TABLE IF NOT EXISTS payment_requests (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  user_name     TEXT,
  plan          TEXT NOT NULL,
  amount        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'awaiting_payment',
  reference_code TEXT NOT NULL UNIQUE,
  transfer_note TEXT,
  payer_note    TEXT,
  reviewed_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  admin_note    TEXT,
  submitted_at  TIMESTAMPTZ,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON payment_requests(created_at);

-- Support messages
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

CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_role ON support_messages(sender_role);
CREATE INDEX IF NOT EXISTS idx_support_messages_admin_unread ON support_messages(user_id, is_read_by_admin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_user_unread ON support_messages(user_id, is_read_by_user, created_at DESC);

-- Uploads dedup
CREATE TABLE IF NOT EXISTS uploads (
  id            BIGSERIAL PRIMARY KEY,
  hash          TEXT UNIQUE NOT NULL,
  url           TEXT NOT NULL,
  thumb         TEXT,
  resource_type TEXT DEFAULT 'video',
  public_id     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_hash ON uploads(hash);

-- Bio profiles
CREATE TABLE IF NOT EXISTS bio_profiles (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT,
  subtitle     TEXT,
  avatar       TEXT,
  accent       TEXT DEFAULT '#3b82f6',
  link_count   INTEGER DEFAULT 5,
  link_source  TEXT DEFAULT 'recent',
  is_published BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bio_profiles_slug ON bio_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_bio_profiles_user_id ON bio_profiles(user_id);

-- Function: increment_clicks
CREATE OR REPLACE FUNCTION increment_clicks(link_id BIGINT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE links SET clicks = clicks + 1 WHERE id = link_id;
$$;

CREATE OR REPLACE FUNCTION get_click_analytics_summary(
  p_user_id BIGINT DEFAULT NULL,
  p_guest_session_id TEXT DEFAULT NULL,
  p_days INTEGER DEFAULT 0,
  p_timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
  p_limit INTEGER DEFAULT NULL,
  p_include_all BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
WITH params AS (
  SELECT
    GREATEST(COALESCE(p_days, 0), 0) AS days,
    GREATEST(COALESCE(p_limit, 0), 0) AS row_limit,
    COALESCE(NULLIF(TRIM(p_timezone), ''), 'Asia/Ho_Chi_Minh') AS tz,
    TO_CHAR(
      timezone(COALESCE(NULLIF(TRIM(p_timezone), ''), 'Asia/Ho_Chi_Minh'), NOW()),
      'YYYY-MM-DD'
    ) AS today_key,
    FLOOR(EXTRACT(EPOCH FROM NOW()) / 900)::BIGINT * 900 AS current_bucket_epoch,
    (
      DATE_TRUNC(
        'day',
        timezone(COALESCE(NULLIF(TRIM(p_timezone), ''), 'Asia/Ho_Chi_Minh'), NOW())
      ) - ((GREATEST(COALESCE(p_days, 0), 1) - 1) * INTERVAL '1 day')
    ) AT TIME ZONE COALESCE(NULLIF(TRIM(p_timezone), ''), 'Asia/Ho_Chi_Minh') AS window_start
),
filtered AS (
  SELECT
    c.id,
    c.link_id,
    COALESCE(NULLIF(TRIM(c.ip), ''), 'no-ip') AS visitor_ip,
    COALESCE(NULLIF(TRIM(c.user_agent), ''), 'no-ua') AS visitor_ua,
    c.clicked_at,
    CASE
      WHEN UPPER(TRIM(COALESCE(c.country_code, ''))) ~ '^[A-Z]{2}$'
        AND UPPER(TRIM(COALESCE(c.country_code, ''))) NOT IN ('XX', 'T1')
      THEN UPPER(TRIM(COALESCE(c.country_code, '')))
      ELSE NULL
    END AS country_code_norm,
    NULLIF(TRIM(COALESCE(c.country_name, '')), '') AS country_name_clean,
    COALESCE(NULLIF(TRIM(COALESCE(c.city, '')), ''), 'Không rõ') AS city_name,
    l.original_url,
    l.link_type,
    TO_CHAR(timezone(p.tz, c.clicked_at), 'YYYY-MM-DD') AS day_key,
    CASE
      WHEN COALESCE(l.link_type, '') = 'video' THEN 'video'
      WHEN LOWER(COALESCE(l.original_url, '')) ~ '(^https?://)?shp\.ee([/?#:]|$)' THEN 'shopee'
      WHEN LOWER(COALESCE(l.original_url, '')) ~ '(^https?://)?([^.]+\.)*shopee\.vn([/?#:]|$)' THEN 'shopee'
      WHEN LOWER(COALESCE(l.original_url, '')) ~ '(^https?://)?([^.]+\.)*tiktok\.com([/?#:]|$)' THEN 'tiktok'
      ELSE 'generic'
    END AS platform_key
  FROM clicks c
  INNER JOIN links l ON l.id = c.link_id
  CROSS JOIN params p
  WHERE (
    p_include_all
    OR (p_user_id IS NOT NULL AND l.user_id = p_user_id)
    OR (
      p_user_id IS NULL
      AND p_guest_session_id IS NOT NULL
      AND l.guest_session_id = p_guest_session_id
    )
    OR (
      p_user_id IS NULL
      AND p_guest_session_id IS NULL
      AND l.user_id IS NULL
      AND l.guest_session_id IS NULL
    )
  )
    AND (p.days = 0 OR c.clicked_at >= p.window_start)
),
scoped AS (
  SELECT *
  FROM (
    SELECT
      filtered.*,
      ROW_NUMBER() OVER (ORDER BY clicked_at DESC, id DESC) AS rn
    FROM filtered
  ) ranked
  CROSS JOIN params p
  WHERE p.row_limit = 0 OR rn <= p.row_limit
),
deduped AS (
  SELECT
    scoped.*,
    LAG(clicked_at) OVER (
      PARTITION BY link_id, visitor_ip, visitor_ua
      ORDER BY clicked_at ASC, id ASC
    ) AS prev_clicked_at
  FROM scoped
),
unique_rows AS (
  SELECT *
  FROM deduped
  WHERE prev_clicked_at IS NULL
    OR clicked_at - prev_clicked_at > INTERVAL '30 minutes'
),
raw_timeline AS (
  SELECT day_key, COUNT(*)::INT AS clicks
  FROM scoped
  GROUP BY day_key
),
unique_timeline AS (
  SELECT day_key, COUNT(*)::INT AS clicks
  FROM unique_rows
  GROUP BY day_key
),
raw_country_totals AS (
  SELECT
    country_code_norm AS country_code,
    COALESCE(MAX(country_name_clean), country_code_norm, 'Không rõ') AS country_name,
    COUNT(*)::INT AS clicks
  FROM scoped
  WHERE country_code_norm IS NOT NULL
  GROUP BY country_code_norm
),
unique_country_totals AS (
  SELECT
    country_code_norm AS country_code,
    COALESCE(MAX(country_name_clean), country_code_norm, 'Không rõ') AS country_name,
    COUNT(*)::INT AS clicks
  FROM unique_rows
  WHERE country_code_norm IS NOT NULL
  GROUP BY country_code_norm
),
raw_country_city_counts AS (
  SELECT
    country_code_norm AS country_code,
    COALESCE(MAX(country_name_clean), country_code_norm, 'Không rõ') AS country_name,
    city_name AS city,
    COUNT(*)::INT AS city_clicks
  FROM scoped
  WHERE country_code_norm IS NOT NULL
  GROUP BY country_code_norm, city_name
),
unique_country_city_counts AS (
  SELECT
    country_code_norm AS country_code,
    COALESCE(MAX(country_name_clean), country_code_norm, 'Không rõ') AS country_name,
    city_name AS city,
    COUNT(*)::INT AS city_clicks
  FROM unique_rows
  WHERE country_code_norm IS NOT NULL
  GROUP BY country_code_norm, city_name
),
raw_country_top_city AS (
  SELECT *
  FROM (
    SELECT
      raw_country_city_counts.*,
      ROW_NUMBER() OVER (
        PARTITION BY country_code
        ORDER BY city_clicks DESC, city ASC
      ) AS city_rank
    FROM raw_country_city_counts
  ) ranked
  WHERE city_rank = 1
),
unique_country_top_city AS (
  SELECT *
  FROM (
    SELECT
      unique_country_city_counts.*,
      ROW_NUMBER() OVER (
        PARTITION BY country_code
        ORDER BY city_clicks DESC, city ASC
      ) AS city_rank
    FROM unique_country_city_counts
  ) ranked
  WHERE city_rank = 1
),
raw_platform_counts AS (
  SELECT
    platform_key AS key,
    COUNT(*)::INT AS clicks,
    SUM(CASE WHEN day_key = p.today_key THEN 1 ELSE 0 END)::INT AS clicks_today
  FROM scoped
  CROSS JOIN params p
  GROUP BY platform_key
),
unique_platform_counts AS (
  SELECT
    platform_key AS key,
    COUNT(*)::INT AS clicks,
    SUM(CASE WHEN day_key = p.today_key THEN 1 ELSE 0 END)::INT AS clicks_today
  FROM unique_rows
  CROSS JOIN params p
  GROUP BY platform_key
),
recent_bucket_counts AS (
  SELECT
    FLOOR(EXTRACT(EPOCH FROM clicked_at) / 900)::BIGINT * 900 AS bucket_epoch,
    COUNT(*)::INT AS clicks
  FROM scoped
  CROSS JOIN params p
  WHERE FLOOR(EXTRACT(EPOCH FROM clicked_at) / 900)::BIGINT * 900 >= p.current_bucket_epoch - (4 * 900)
  GROUP BY bucket_epoch
)
SELECT JSONB_BUILD_OBJECT(
  'total_clicks',
  (SELECT COUNT(*)::INT FROM scoped),
  'unique_clicks',
  (SELECT COUNT(*)::INT FROM unique_rows),
  'timeline',
  COALESCE(
    (
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT('date', day_key, 'clicks', clicks)
        ORDER BY day_key
      )
      FROM raw_timeline
    ),
    '[]'::JSONB
  ),
  'unique_timeline',
  COALESCE(
    (
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT('date', day_key, 'clicks', clicks)
        ORDER BY day_key
      )
      FROM unique_timeline
    ),
    '[]'::JSONB
  ),
  'recent_buckets',
  COALESCE(
    (
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'bucket_started_at',
          TO_CHAR(
            to_timestamp(bucket_epoch) AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'clicks',
          clicks
        )
        ORDER BY bucket_epoch
      )
      FROM recent_bucket_counts
    ),
    '[]'::JSONB
  ),
  'geo',
  JSONB_BUILD_OBJECT(
    'tracked_clicks',
    (SELECT COUNT(*)::INT FROM scoped WHERE country_code_norm IS NOT NULL),
    'unknown_clicks',
    (SELECT COUNT(*)::INT FROM scoped WHERE country_code_norm IS NULL),
    'countries',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'country_code', country_code,
            'country_name', country_name,
            'clicks', clicks
          )
          ORDER BY clicks DESC, country_code ASC
        )
        FROM raw_country_totals
      ),
      '[]'::JSONB
    ),
    'top_countries',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'country_code', t.country_code,
            'country_name', t.country_name,
            'clicks', t.clicks,
            'city', c.city,
            'city_clicks', c.city_clicks
          )
          ORDER BY t.clicks DESC, t.country_code ASC
        )
        FROM (
          SELECT *
          FROM raw_country_totals
          ORDER BY clicks DESC, country_code ASC
          LIMIT 8
        ) t
        LEFT JOIN raw_country_top_city c ON c.country_code = t.country_code
      ),
      '[]'::JSONB
    ),
    'unique_tracked_clicks',
    (SELECT COUNT(*)::INT FROM unique_rows WHERE country_code_norm IS NOT NULL),
    'unique_unknown_clicks',
    (SELECT COUNT(*)::INT FROM unique_rows WHERE country_code_norm IS NULL),
    'unique_countries',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'country_code', country_code,
            'country_name', country_name,
            'clicks', clicks
          )
          ORDER BY clicks DESC, country_code ASC
        )
        FROM unique_country_totals
      ),
      '[]'::JSONB
    ),
    'unique_top_countries',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'country_code', t.country_code,
            'country_name', t.country_name,
            'clicks', t.clicks,
            'city', c.city,
            'city_clicks', c.city_clicks
          )
          ORDER BY t.clicks DESC, t.country_code ASC
        )
        FROM (
          SELECT *
          FROM unique_country_totals
          ORDER BY clicks DESC, country_code ASC
          LIMIT 8
        ) t
        LEFT JOIN unique_country_top_city c ON c.country_code = t.country_code
      ),
      '[]'::JSONB
    )
  ),
  'platforms',
  JSONB_BUILD_OBJECT(
    'distribution',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT('key', key, 'clicks', clicks)
          ORDER BY clicks DESC, key ASC
        )
        FROM raw_platform_counts
      ),
      '[]'::JSONB
    ),
    'today_distribution',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'key', key,
            'clicks', clicks,
            'clicks_today', clicks_today
          )
          ORDER BY clicks DESC, key ASC
        )
        FROM raw_platform_counts
      ),
      '[]'::JSONB
    ),
    'unique_distribution',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT('key', key, 'clicks', clicks)
          ORDER BY clicks DESC, key ASC
        )
        FROM unique_platform_counts
      ),
      '[]'::JSONB
    ),
    'unique_today_distribution',
    COALESCE(
      (
        SELECT JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'key', key,
            'clicks', clicks,
            'clicks_today', clicks_today
          )
          ORDER BY clicks DESC, key ASC
        )
        FROM unique_platform_counts
      ),
      '[]'::JSONB
    )
  )
);
$$;

-- Row Level Security
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE links DISABLE ROW LEVEL SECURITY;
ALTER TABLE clicks DISABLE ROW LEVEL SECURITY;
ALTER TABLE domains DISABLE ROW LEVEL SECURITY;
ALTER TABLE login_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE uploads DISABLE ROW LEVEL SECURITY;
ALTER TABLE bio_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages DISABLE ROW LEVEL SECURITY;
