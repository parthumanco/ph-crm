-- Migration 06: add estimated_hours to project_tasks
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS estimated_hours numeric;
