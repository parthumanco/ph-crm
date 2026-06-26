-- Migration 27: remove assigned_to CHECK constraints so client contacts can be assigned
-- Run this in your Supabase SQL Editor

-- Drop any CHECK constraint on tasks.assigned_to (constraint name may vary)
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT tc.constraint_name INTO con_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc USING (constraint_name, constraint_schema)
  WHERE tc.table_name = 'tasks'
    AND cc.check_clause LIKE '%assigned_to%';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE tasks DROP CONSTRAINT ' || quote_ident(con_name);
    RAISE NOTICE 'Dropped tasks constraint: %', con_name;
  ELSE
    RAISE NOTICE 'No assigned_to constraint found on tasks';
  END IF;
END $$;

-- Drop any CHECK constraint on project_tasks.assigned_to
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT tc.constraint_name INTO con_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.check_constraints cc USING (constraint_name, constraint_schema)
  WHERE tc.table_name = 'project_tasks'
    AND cc.check_clause LIKE '%assigned_to%';
  IF con_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE project_tasks DROP CONSTRAINT ' || quote_ident(con_name);
    RAISE NOTICE 'Dropped project_tasks constraint: %', con_name;
  ELSE
    RAISE NOTICE 'No assigned_to constraint found on project_tasks';
  END IF;
END $$;
