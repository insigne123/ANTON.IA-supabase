-- Add limits to antonia_config
alter table antonia_config 
add column if not exists daily_search_limit int default 100,
add column if not exists daily_enrich_limit int default 50,
add column if not exists daily_investigate_limit int default 20;

-- Create table to track daily usage
create table if not exists antonia_daily_usage (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  date date not null default current_date,
  leads_searched int default 0,
  leads_enriched int default 0,
  leads_investigated int default 0,
  updated_at timestamptz default now(),
  unique(organization_id, date)
);

-- RLS for usage
alter table antonia_daily_usage enable row level security;

create policy "Users view own org usage" on antonia_daily_usage 
for select using (organization_id in (select organization_id from organization_members where user_id = auth.uid()));

-- No insert/update policy needed for users if the worker (service role) handles updates, 
-- but if we want the UI to read it, select is enough.
