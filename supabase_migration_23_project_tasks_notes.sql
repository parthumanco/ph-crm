-- Migration 23: add notes column to project_tasks
-- Action items from meeting transcripts can include context notes.
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS notes text;
