-- Migration 03: add deep_scanned flag to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deep_scanned boolean DEFAULT false;
