-- Migration 12: Add archived_at to project_files
alter table project_files add column if not exists archived_at timestamptz default null;
