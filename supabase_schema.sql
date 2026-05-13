-- Part Human CRM — Supabase Schema
-- Run this entire file in your Supabase SQL Editor

-- Companies (populated by SignalWatch scans or manual entry)
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  hq text,
  industry text,
  funding_stage text,
  employee_count text,
  icp_tier text,
  icp_score integer,
  overall_score integer,
  summary text,
  triggers jsonb default '[]'::jsonb,
  recommended_angle text,
  contact_angles jsonb default '[]'::jsonb,
  contacts jsonb default '[]'::jsonb,
  scan_date timestamptz,
  created_at timestamptz default now()
);

-- Pipeline entries (one row per company actively being worked)
create table if not exists pipeline_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  cycle_number integer default 1,
  current_touch integer default 0,
  status text default 'active' check (status in ('active','responded','paused','won','lost')),
  priority text default 'normal' check (priority in ('high','normal','low')),
  notes text,
  added_by text,
  week_start date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Individual touches (emails and LinkedIn messages)
create table if not exists touches (
  id uuid primary key default gen_random_uuid(),
  pipeline_entry_id uuid references pipeline_entries(id) on delete cascade,
  touch_number integer not null check (touch_number between 1 and 5),
  touch_type text not null check (touch_type in ('email','linkedin')),
  contact_name text,
  contact_title text,
  subject_line text,
  draft_content text,
  scheduled_date date,
  sent_date date,
  status text default 'draft' check (status in ('draft','ready','sent','responded','skipped')),
  response_text text,
  ai_next_step text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Weekly reports
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  generated_at timestamptz default now(),
  new_companies jsonb default '[]'::jsonb,
  followups jsonb default '[]'::jsonb,
  total_touches integer default 0,
  report_html text
);

-- Disable RLS for internal tool (no public-facing auth needed)
alter table companies disable row level security;
alter table pipeline_entries disable row level security;
alter table touches disable row level security;
alter table weekly_reports disable row level security;
