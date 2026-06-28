CREATE INDEX IF NOT EXISTS idx_links_user_id_created_at
  ON links(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_links_guest_session_id_created_at
  ON links(guest_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clicks_link_id_clicked_at
  ON clicks(link_id, clicked_at DESC);
