ALTER TABLE users
  ADD COLUMN IF NOT EXISTS lab_shared_settings_json JSONB NOT NULL DEFAULT '{}'::jsonb;
