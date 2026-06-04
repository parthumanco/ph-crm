-- Migration 13: Allow project_meetings to belong to a deal (pre-project)
alter table project_meetings add column if not exists deal_id uuid references deals(id) on delete cascade;
alter table project_meetings alter column project_id drop not null;
create index if not exists project_meetings_deal_id_idx on project_meetings(deal_id);
