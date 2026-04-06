-- ANTONIA autopilot controls + exception queue

create extension if not exists pgcrypto;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'antonia_config'
  ) then
    alter table public.antonia_config
      add column if not exists autopilot_enabled boolean not null default false,
      add column if not exists autopilot_mode text not null default 'manual_assist',
      add column if not exists approval_mode text not null default 'low_score_only',
      add column if not exists min_auto_send_score integer not null default 70,
      add column if not exists min_review_score integer not null default 45,
      add column if not exists booking_link text,
      add column if not exists meeting_instructions text,
      add column if not exists pause_on_negative_reply boolean not null default true,
      add column if not exists pause_on_failure_spike boolean not null default true;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'antonia_config'
      and column_name = 'autopilot_mode'
  ) then
    alter table public.antonia_config
      drop constraint if exists antonia_config_autopilot_mode_check,
      add constraint antonia_config_autopilot_mode_check
        check (autopilot_mode in ('manual_assist', 'semi_auto', 'full_auto'));
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'antonia_config'
      and column_name = 'approval_mode'
  ) then
    alter table public.antonia_config
      drop constraint if exists antonia_config_approval_mode_check,
      add constraint antonia_config_approval_mode_check
        check (approval_mode in ('all_contacts', 'low_score_only', 'high_risk_only', 'disabled'));
  end if;
end $$;

create table if not exists public.antonia_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  mission_id uuid references public.antonia_missions(id) on delete cascade,
  task_id uuid references public.antonia_tasks(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  category text not null,
  severity text not null default 'medium',
  status text not null default 'open',
  title text not null,
  description text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'antonia_exceptions'
  ) then
    alter table public.antonia_exceptions
      add column if not exists organization_id uuid,
      add column if not exists mission_id uuid,
      add column if not exists task_id uuid,
      add column if not exists lead_id uuid,
      add column if not exists category text,
      add column if not exists severity text default 'medium',
      add column if not exists status text default 'open',
      add column if not exists title text,
      add column if not exists description text,
      add column if not exists dedupe_key text,
      add column if not exists payload jsonb default '{}'::jsonb,
      add column if not exists resolution_note text,
      add column if not exists created_at timestamptz default now(),
      add column if not exists updated_at timestamptz default now(),
      add column if not exists resolved_at timestamptz;

    alter table public.antonia_exceptions
      drop constraint if exists antonia_exceptions_severity_check,
      add constraint antonia_exceptions_severity_check
        check (severity in ('low', 'medium', 'high', 'critical'));

    alter table public.antonia_exceptions
      drop constraint if exists antonia_exceptions_status_check,
      add constraint antonia_exceptions_status_check
        check (status in ('open', 'approved', 'resolved', 'dismissed'));
  end if;
end $$;

create index if not exists antonia_exceptions_org_status_idx
  on public.antonia_exceptions(organization_id, status, created_at desc);

create index if not exists antonia_exceptions_mission_status_idx
  on public.antonia_exceptions(mission_id, status, created_at desc);

create index if not exists antonia_exceptions_category_idx
  on public.antonia_exceptions(category, severity, created_at desc);

create unique index if not exists antonia_exceptions_open_dedupe_uidx
  on public.antonia_exceptions(dedupe_key)
  where dedupe_key is not null and status = 'open';

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'leads'
  ) then
    alter table public.leads
      add column if not exists score integer not null default 0,
      add column if not exists score_tier text not null default 'cold',
      add column if not exists score_reason text,
      add column if not exists last_scored_at timestamptz;

    alter table public.leads
      drop constraint if exists leads_score_tier_check,
      add constraint leads_score_tier_check
        check (score_tier in ('hot', 'warm', 'cool', 'cold'));
  end if;
end $$;

create index if not exists leads_org_score_idx
  on public.leads(organization_id, score desc, created_at desc);

create index if not exists leads_mission_score_idx
  on public.leads(mission_id, score desc, created_at desc);

notify pgrst, 'reload config';
