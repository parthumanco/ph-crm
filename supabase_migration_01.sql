-- Migration 01 — Run this in your Supabase SQL Editor

ALTER TABLE companies ADD COLUMN IF NOT EXISTS lat float;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS lng float;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_count_num integer;
