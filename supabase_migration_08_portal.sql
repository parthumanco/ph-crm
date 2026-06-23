ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token text UNIQUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS portal_password text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_email text;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS approved_by text;
