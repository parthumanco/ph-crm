-- Migration 21: allow project_tasks to exist without a milestone
-- The app supports "unassigned" tasks (milestone_id = null) for tasks
-- that come from meeting imports or are manually added without a milestone.
ALTER TABLE project_tasks
  ALTER COLUMN milestone_id DROP NOT NULL;
