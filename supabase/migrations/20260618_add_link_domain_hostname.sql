-- Persist the selected short-link hostname per link.
-- Safe to run multiple times.

ALTER TABLE links
  ADD COLUMN IF NOT EXISTS domain_hostname TEXT;

CREATE INDEX IF NOT EXISTS idx_links_domain_hostname ON links(domain_hostname);
