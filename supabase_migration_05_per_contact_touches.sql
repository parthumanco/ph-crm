-- Migration 05: per-contact touch tracking
-- Allow each contact at a company to have independent T1-T5 touches

-- Ensure contact_name has a consistent empty-string default for old rows
UPDATE public.touches SET contact_name = '' WHERE contact_name IS NULL;
ALTER TABLE public.touches ALTER COLUMN contact_name SET DEFAULT '';

-- Drop the old unique constraint (one touch per pipeline_entry+touch_number)
ALTER TABLE public.touches DROP CONSTRAINT IF EXISTS touches_pipeline_entry_id_touch_number_key;

-- Add new unique constraint: one touch per (pipeline_entry, contact, touch_number)
ALTER TABLE public.touches
  ADD CONSTRAINT touches_per_contact_unique
  UNIQUE (pipeline_entry_id, contact_name, touch_number);
