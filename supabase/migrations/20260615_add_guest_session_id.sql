-- Add guest session support to existing Supabase databases.
-- Safe to run more than once.

ALTER TABLE links
  ADD COLUMN IF NOT EXISTS guest_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_links_guest_session_id
  ON links(guest_session_id);
