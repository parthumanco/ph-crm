-- Migration 20: add attendees and meeting_time to project_meetings
ALTER TABLE project_meetings
  ADD COLUMN IF NOT EXISTS attendees    text[],
  ADD COLUMN IF NOT EXISTS meeting_time text;
