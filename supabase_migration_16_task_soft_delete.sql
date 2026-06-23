-- Migration 16: add deleted_at to project_tasks for soft-delete support
-- Run in Supabase SQL Editor

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Index so the IS NULL filter on deleted_at is fast
CREATE INDEX IF NOT EXISTS project_tasks_deleted_at_idx
  ON project_tasks (deleted_at)
  WHERE deleted_at IS NULL;
