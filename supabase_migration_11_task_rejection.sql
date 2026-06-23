-- Migration 11: task rejection / chain of custody
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejected_at        timestamptz;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejected_by        text;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejection_notes    text;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejection_response text;
