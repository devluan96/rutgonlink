ALTER TABLE clicks ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS country_name TEXT;
ALTER TABLE clicks ADD COLUMN IF NOT EXISTS city TEXT;

CREATE INDEX IF NOT EXISTS idx_clicks_country_code ON clicks(country_code);
