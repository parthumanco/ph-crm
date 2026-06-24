-- Add portal_contact column to project_tasks.
-- Stores the external contact ({name, email}) who should see this task on the client portal.
-- Run this in your Supabase SQL editor or via `supabase db push`.

ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS portal_contact jsonb;

-- Milestone-level client contact: overrides primary for all task notifications in the milestone
ALTER TABLE milestones
  ADD COLUMN IF NOT EXISTS portal_contact jsonb;
