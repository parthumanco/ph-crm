-- Migration 14: Clients table + research items

create table if not exists clients (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  website      text,
  linkedin_url text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Case-insensitive unique index so "Venn" and "venn" are the same client
create unique index if not exists clients_name_ci_idx on clients (lower(trim(name)));

-- Link projects to clients
alter table projects add column if not exists client_id uuid references clients(id);

-- Research items: notes, links, articles
create table if not exists client_items (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references clients(id) on delete cascade,
  type       text        not null default 'note' check (type in ('note','link')),
  title      text        not null default '',
  url        text,
  body       text,
  added_by   text,
  created_at timestamptz not null default now()
);

create index if not exists client_items_client_id_idx on client_items(client_id);

-- RLS
alter table clients      enable row level security;
alter table client_items enable row level security;

create policy "auth_clients"
  on clients for all to authenticated
  using (true) with check (true);

create policy "auth_client_items"
  on client_items for all to authenticated
  using (true) with check (true);

-- ── Seed existing clients from projects ──────────────────────────────────────
insert into clients (name)
select distinct trim(client_name)
from projects
where client_name is not null and trim(client_name) != ''
on conflict do nothing;

-- Link project rows to their client records
update projects p
set client_id = c.id
from clients c
where lower(trim(p.client_name)) = lower(c.name)
  and p.client_id is null;
