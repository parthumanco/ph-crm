-- Migration 07: add budget (contract value) to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS budget numeric;
