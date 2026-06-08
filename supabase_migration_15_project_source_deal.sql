-- Migration 15: Link projects back to their source deal
alter table projects add column if not exists source_deal_id uuid references deals(id) on delete set null;
create index if not exists projects_source_deal_id_idx on projects(source_deal_id);
