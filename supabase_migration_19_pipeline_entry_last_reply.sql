-- Migration 19: store prospect reply text on pipeline entries
-- Run in Supabase SQL Editor

ALTER TABLE pipeline_entries
  ADD COLUMN IF NOT EXISTS last_reply text;
