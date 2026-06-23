-- Migration 18: add internal_notes to projects for Activity-tab notes
-- Run in Supabase SQL Editor

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS internal_notes text;
