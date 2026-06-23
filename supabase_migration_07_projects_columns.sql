-- Migration 07: ensure all expected columns exist on projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name   text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_name  text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description   text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget        numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at   timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS proposal_text text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS proposal_pdf_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS proposal_page_hints jsonb;
