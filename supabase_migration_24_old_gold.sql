-- Migration 24: Old Gold — Pete's warm outreach discovery tracker

CREATE TABLE IF NOT EXISTS old_gold_prospects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  company     text,
  title       text,
  email       text,
  linkedin    text,
  notes       text,
  status      text DEFAULT 'warm',   -- warm | cold | meeting_set | following_up | passed
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS old_gold_meetings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id   uuid REFERENCES old_gold_prospects(id) ON DELETE CASCADE,
  title         text,
  meeting_date  date,
  transcript    text,
  summary       text,
  action_items  jsonb DEFAULT '[]',
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS old_gold_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid REFERENCES old_gold_prospects(id) ON DELETE CASCADE,
  meeting_id   uuid REFERENCES old_gold_meetings(id) ON DELETE SET NULL,
  title        text NOT NULL,
  due_date     date,
  notes        text,
  completed    boolean DEFAULT false,
  completed_at timestamptz,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_old_gold_meetings_prospect ON old_gold_meetings(prospect_id);
CREATE INDEX IF NOT EXISTS idx_old_gold_tasks_prospect    ON old_gold_tasks(prospect_id);
