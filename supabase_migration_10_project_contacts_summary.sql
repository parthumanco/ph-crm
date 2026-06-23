-- Migration 10: project contacts list and AI summary
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contacts     jsonb       DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary   text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ai_summary_at timestamptz;
