-- Migration 12: append-only review chain per task
-- Run migrations 11 and 12 together if 11 has not been applied yet.
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejected_at        timestamptz;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejected_by        text;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejection_notes    text;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS rejection_response text;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS review_chain       jsonb DEFAULT '[]'::jsonb;
