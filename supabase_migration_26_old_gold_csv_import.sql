-- Migration 26: schema fixes needed for the new Old Gold CSV import feature
-- (and to fix a pre-existing, silent bug in the manual "+ Add Contact" form).
--
-- old_gold_prospects is missing `title` and `updated_at` — both columns the
-- app's code has always assumed exist (ProspectForm has a Title field;
-- handleSaveProspect writes updated_at on edit). The live schema drifted from
-- supabase_migration_24_old_gold.sql at some point, which silently broke any
-- save that included a title (Supabase rejects the whole insert/update when
-- it contains an unknown column).
alter table old_gold_prospects add column if not exists title text;
alter table old_gold_prospects add column if not exists updated_at timestamptz default now();

-- companies.tags is read in several places (documents.js, OldGoldPage,
-- SignalWatchPage) but was never actually created by any prior migration —
-- it's needed now to tag companies "Old Gold" when imported from a LinkedIn
-- contacts CSV.
alter table companies add column if not exists tags jsonb default '[]'::jsonb;
