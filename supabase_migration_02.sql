-- Migration 02 — Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS app_settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);
