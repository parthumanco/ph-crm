-- Migration 11: Project meetings log
create table if not exists project_meetings (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references projects(id) on delete cascade,
  title        text        not null,
  meeting_date date,
  summary      text,
  transcript   text,
  action_items jsonb       not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists project_meetings_project_id_idx on project_meetings(project_id);

alter table project_meetings enable row level security;

create policy "authenticated users can manage project_meetings"
  on project_meetings for all
  to authenticated
  using (true)
  with check (true);
