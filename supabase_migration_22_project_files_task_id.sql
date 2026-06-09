-- Migration 22: ensure project_files has a task_id FK column
-- This allows files to be attached directly to a project_task rather
-- than just to a project or milestone.
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES project_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_files_task_id ON project_files(task_id);
