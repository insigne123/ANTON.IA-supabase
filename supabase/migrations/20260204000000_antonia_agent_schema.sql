-- Antonia Agent schema alignment (safe / non-destructive)
-- This migration is intentionally defensive because older installs use:
-- - contacted_leads.lead_id as TEXT (not UUID)
-- - contacted_leads without organization_id / mission_id
-- We only ADD columns/tables/indexes when missing.

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- === LEADS (adds org/mission + enrichment fields used by worker) ===
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'leads'
  ) then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='organization_id') then
      alter table public.leads add column organization_id uuid;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='mission_id') then
      alter table public.leads add column mission_id uuid;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='apollo_id') then
      alter table public.leads add column apollo_id text;
    end if;

    -- Common lead fields used by the app (safe to add if missing)
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='email') then
      alter table public.leads add column email text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='linkedin_url') then
      alter table public.leads add column linkedin_url text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='company_website') then
      alter table public.leads add column company_website text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='industry') then
      alter table public.leads add column industry text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='location') then
      alter table public.leads add column location text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='country') then
      alter table public.leads add column country text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='city') then
      alter table public.leads add column city text;
    end if;

    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='last_enriched_at') then
      alter table public.leads add column last_enriched_at timestamptz;
    end if;
  end if;
end $$;

-- Indexes (only if columns exist)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='organization_id') then
    execute 'create index if not exists leads_org_id_idx on public.leads(organization_id)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='mission_id') then
    execute 'create index if not exists leads_mission_id_idx on public.leads(mission_id)';
    execute 'create index if not exists leads_mission_status_idx on public.leads(mission_id, status)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='apollo_id') then
    execute 'create index if not exists leads_apollo_id_idx on public.leads(apollo_id)';
  end if;
end $$;

-- === CONTACTED_LEADS (evaluation + tracking fields) ===
-- Ensure contacted_leads.id has a default (older schema had TEXT PK without default)
do $$
declare
  id_type text;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'contacted_leads'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='contacted_leads' and column_name='id'
    ) then
      select data_type into id_type
      from information_schema.columns
      where table_schema='public' and table_name='contacted_leads' and column_name='id';

      if id_type = 'text' then
        execute 'alter table public.contacted_leads alter column id set default (gen_random_uuid()::text)';
      elsif id_type = 'uuid' then
        execute 'alter table public.contacted_leads alter column id set default gen_random_uuid()';
      end if;
    end if;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'contacted_leads'
  ) then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='organization_id') then
      alter table public.contacted_leads add column organization_id uuid;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='mission_id') then
      alter table public.contacted_leads add column mission_id uuid;
    end if;

    -- IMPORTANT: keep lead_id as TEXT if it already exists as TEXT.
    -- Only add it if missing.
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='lead_id') then
      alter table public.contacted_leads add column lead_id text;
    end if;

    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='evaluation_status') then
      alter table public.contacted_leads add column evaluation_status text default 'pending';
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='engagement_score') then
      alter table public.contacted_leads add column engagement_score integer default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='last_interaction_at') then
      alter table public.contacted_leads add column last_interaction_at timestamptz;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='last_update_at') then
      alter table public.contacted_leads add column last_update_at timestamptz default now();
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='click_count') then
      alter table public.contacted_leads add column click_count integer default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='clicked_at') then
      alter table public.contacted_leads add column clicked_at timestamptz;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='opened_at') then
      alter table public.contacted_leads add column opened_at timestamptz;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='replied_at') then
      alter table public.contacted_leads add column replied_at timestamptz;
    end if;

    -- UI/analytics fields (nullable)
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='name') then
      alter table public.contacted_leads add column name text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='email') then
      alter table public.contacted_leads add column email text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='company') then
      alter table public.contacted_leads add column company text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='role') then
      alter table public.contacted_leads add column role text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='industry') then
      alter table public.contacted_leads add column industry text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='city') then
      alter table public.contacted_leads add column city text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='country') then
      alter table public.contacted_leads add column country text;
    end if;
  end if;
end $$;

-- Indexes for contacted_leads (only if columns exist)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='organization_id') then
    execute 'create index if not exists contacted_leads_org_id_idx on public.contacted_leads(organization_id)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='mission_id') then
    execute 'create index if not exists contacted_leads_mission_id_idx on public.contacted_leads(mission_id)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='evaluation_status') then
    execute 'create index if not exists contacted_leads_eval_idx on public.contacted_leads(evaluation_status, last_interaction_at)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='contacted_leads' and column_name='lead_id') then
    execute 'create index if not exists contacted_leads_lead_id_idx on public.contacted_leads(lead_id)';
  end if;
end $$;

-- === LEAD_RESPONSES (webhook events) ===
create table if not exists public.lead_responses (
  id uuid primary key default gen_random_uuid(),
  lead_id text,
  email_message_id text,
  type text not null,
  content text,
  created_at timestamptz not null default now()
);

-- If the table already exists from a previous version, ensure expected columns exist.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lead_responses'
  ) then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='lead_responses' and column_name='organization_id') then
      alter table public.lead_responses add column organization_id uuid;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='lead_responses' and column_name='mission_id') then
      alter table public.lead_responses add column mission_id uuid;
    end if;
  end if;
end $$;

-- Indexes for lead_responses (only if columns exist)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='lead_responses' and column_name='lead_id') then
    execute 'create index if not exists lead_responses_lead_id_idx on public.lead_responses(lead_id)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='lead_responses' and column_name='organization_id') then
    execute 'create index if not exists lead_responses_org_id_idx on public.lead_responses(organization_id)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='lead_responses' and column_name='mission_id') then
    execute 'create index if not exists lead_responses_mission_id_idx on public.lead_responses(mission_id)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='lead_responses' and column_name='type') then
    execute 'create index if not exists lead_responses_type_idx on public.lead_responses(type)';
  end if;
end $$;

-- Refresh schema cache (PostgREST)
notify pgrst, 'reload config';
