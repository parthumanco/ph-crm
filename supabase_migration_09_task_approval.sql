-- Migration 09: client task approval
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS approved_at  timestamptz;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS approved_by  text;
