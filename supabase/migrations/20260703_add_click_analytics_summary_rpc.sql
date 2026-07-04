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
