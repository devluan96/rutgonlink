ALTER TABLE login_events ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS country_name TEXT;
ALTER TABLE login_events ADD COLUMN IF NOT EXISTS city TEXT;

CREATE INDEX IF NOT EXISTS idx_login_events_country_code ON login_events(country_code);
