-- Migration 17: add proposals JSONB array to projects for multi-proposal support
-- Run in Supabase SQL Editor

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS proposals jsonb DEFAULT '[]'::jsonb;
