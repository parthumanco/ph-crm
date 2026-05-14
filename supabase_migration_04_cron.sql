-- Migration 04: schedule the weekly rescan edge function every Sunday at 11pm UTC (7pm ET)
-- Run this in the Supabase SQL Editor after deploying the edge function.

-- Enable pg_net extension (needed to call edge functions from cron)
create extension if not exists pg_net with schema extensions;

-- Schedule the weekly rescan
select cron.schedule(
  'weekly-rescan-sunday',          -- job name
  '0 23 * * 0',                    -- Sunday 11pm UTC
  $$
  select extensions.http_post(
    url    := 'https://hvkayprxwtyaqlsydohf.supabase.co/functions/v1/weekly-rescan',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key', true)
    ),
    body   := '{}'::jsonb
  );
  $$
);
