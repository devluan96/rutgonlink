-- Add real team workspace backend and shared link templates.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS workspaces (
  id            BIGSERIAL PRIMARY KEY,
  owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON workspaces(owner_user_id);

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

ALTER TABLE links
  ADD COLUMN IF NOT EXISTS workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL;

ALTER TABLE links
  ADD COLUMN IF NOT EXISTS template_id BIGINT;

ALTER TABLE links
  ADD COLUMN IF NOT EXISTS created_from_template BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_links_workspace_id ON links(workspace_id);
CREATE INDEX IF NOT EXISTS idx_links_template_id ON links(template_id);

CREATE TABLE IF NOT EXISTS workspace_link_templates (
  id                 BIGSERIAL PRIMARY KEY,
  workspace_id       BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  source_link_id     BIGINT REFERENCES links(id) ON DELETE SET NULL,
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

ALTER TABLE workspace_link_templates
  ADD COLUMN IF NOT EXISTS media_link_id BIGINT REFERENCES links(id) ON DELETE SET NULL;

ALTER TABLE workspace_link_templates
  ADD COLUMN IF NOT EXISTS source_link_ids_json JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_workspace_link_templates_media_link_id ON workspace_link_templates(media_link_id);
