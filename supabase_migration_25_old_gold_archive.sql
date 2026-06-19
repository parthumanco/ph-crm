-- Migration 25: Add archived_at to old_gold_prospects so "Delete contact" becomes
-- a reversible archive instead of a permanent hard delete.
alter table old_gold_prospects add column if not exists archived_at timestamptz default null;
