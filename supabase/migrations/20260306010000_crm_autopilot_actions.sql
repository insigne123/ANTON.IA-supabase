-- CRM autopilot fields + support table if missing

create extension if not exists pgcrypto;

create table if not exists public.unified_crm_data (
  id text primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  stage text,
  owner text,
  notes text,
  next_action text,
  next_action_type text,
  next_action_due_at timestamptz,
  autopilot_status text,
  last_autopilot_event text,
  meeting_link text,
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'unified_crm_data'
  ) then
    alter table public.unified_crm_data
      add column if not exists organization_id uuid,
      add column if not exists stage text,
      add column if not exists owner text,
      add column if not exists notes text,
      add column if not exists next_action text,
      add column if not exists next_action_type text,
      add column if not exists next_action_due_at timestamptz,
      add column if not exists autopilot_status text,
      add column if not exists last_autopilot_event text,
      add column if not exists meeting_link text,
      add column if not exists updated_at timestamptz default now();
  end if;
end $$;

create index if not exists unified_crm_data_org_updated_idx
  on public.unified_crm_data(organization_id, updated_at desc);

create index if not exists unified_crm_data_next_action_idx
  on public.unified_crm_data(organization_id, next_action_due_at asc);

notify pgrst, 'reload config';
