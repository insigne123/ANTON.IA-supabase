-- ANTONIA core + observability (safe / additive)
-- Goal:
-- - Ensure core ANTONIA tables exist in fresh installs
-- - Add task progress/heartbeat fields for real-time monitoring
-- - Add lead-level event stream so the UI can explain exactly what happened

create extension if not exists pgcrypto;

-- === Core tables ===

create table if not exists public.antonia_config (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  notification_email text,
  daily_report_enabled boolean not null default true,
  instant_alerts_enabled boolean not null default true,
  daily_search_limit integer not null default 3,
  daily_enrich_limit integer not null default 50,
  daily_investigate_limit integer not null default 20,
  tracking_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.antonia_missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'failed')),
  goal_summary text,
  params jsonb not null default '{}'::jsonb,
  daily_search_limit integer not null default 1,
  daily_enrich_limit integer not null default 10,
  daily_investigate_limit integer not null default 5,
  daily_contact_limit integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists antonia_missions_org_id_idx on public.antonia_missions(organization_id);
create index if not exists antonia_missions_status_idx on public.antonia_missions(status, created_at);

create table if not exists public.antonia_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  mission_id uuid references public.antonia_missions(id) on delete cascade,
  type text not null,
  status text not null default 'pending',
  payload jsonb,
  result jsonb,
  error_message text,
  retry_count integer not null default 0,
  scheduled_for timestamptz,
  processing_started_at timestamptz,
  idempotency_key text,

  -- Observability
  progress_current integer,
  progress_total integer,
  progress_label text,
  heartbeat_at timestamptz,
  worker_id text,
  worker_source text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If core tables existed previously, ensure new columns exist (defensive / additive)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='antonia_tasks') then
    -- Core
    alter table public.antonia_tasks
      add column if not exists organization_id uuid,
      add column if not exists mission_id uuid,
      add column if not exists type text,
      add column if not exists status text,
      add column if not exists payload jsonb,
      add column if not exists result jsonb,
      add column if not exists error_message text,
      add column if not exists retry_count integer default 0,
      add column if not exists scheduled_for timestamptz,
      add column if not exists processing_started_at timestamptz,
      add column if not exists idempotency_key text,
      add column if not exists created_at timestamptz default now(),
      add column if not exists updated_at timestamptz default now();

    -- Observability
    alter table public.antonia_tasks
      add column if not exists progress_current integer,
      add column if not exists progress_total integer,
      add column if not exists progress_label text,
      add column if not exists heartbeat_at timestamptz,
      add column if not exists worker_id text,
      add column if not exists worker_source text;
  end if;
end $$;

create index if not exists antonia_tasks_mission_id_created_at_idx on public.antonia_tasks(mission_id, created_at desc);
create index if not exists antonia_tasks_org_id_created_at_idx on public.antonia_tasks(organization_id, created_at desc);
create index if not exists antonia_tasks_status_scheduled_idx on public.antonia_tasks(status, scheduled_for);

-- Best-effort idempotency support (used by client-side createTask)
create unique index if not exists antonia_tasks_org_idempotency_key_uidx
  on public.antonia_tasks(organization_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.antonia_logs (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid references public.antonia_missions(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  level text not null default 'info' check (level in ('info', 'success', 'warning', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists antonia_logs_mission_id_created_at_idx on public.antonia_logs(mission_id, created_at desc);
create index if not exists antonia_logs_org_id_created_at_idx on public.antonia_logs(organization_id, created_at desc);

create table if not exists public.antonia_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  mission_id uuid references public.antonia_missions(id) on delete set null,
  type text not null,
  content text not null,
  summary_data jsonb,
  sent_to text[],
  created_at timestamptz not null default now()
);

create index if not exists antonia_reports_org_id_created_at_idx on public.antonia_reports(organization_id, created_at desc);
create index if not exists antonia_reports_mission_id_created_at_idx on public.antonia_reports(mission_id, created_at desc);

create table if not exists public.antonia_daily_usage (
  organization_id uuid references public.organizations(id) on delete cascade,
  date date not null,
  leads_searched integer not null default 0,
  leads_enriched integer not null default 0,
  leads_investigated integer not null default 0,
  search_runs integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, date)
);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='antonia_daily_usage') then
    -- Ensure column "date" exists and is type date
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='antonia_daily_usage' and column_name='date') then
      if exists (
        select 1 from information_schema.columns
        where table_schema='public'
          and table_name='antonia_daily_usage'
          and column_name='date'
          and data_type <> 'date'
      ) then
        alter table public.antonia_daily_usage
          alter column "date" type date using ("date")::date;
      end if;
    else
      alter table public.antonia_daily_usage add column "date" date;
    end if;

    alter table public.antonia_daily_usage
      add column if not exists leads_searched integer default 0,
      add column if not exists leads_enriched integer default 0,
      add column if not exists leads_investigated integer default 0,
      add column if not exists search_runs integer default 0,
      add column if not exists updated_at timestamptz default now();
  end if;
end $$;

create table if not exists public.antonia_usage_increments (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  increment_type text not null,
  amount integer not null default 0,
  created_at timestamptz not null default now(),
  unique (task_id, increment_type)
);

-- Optional: suggestions table (used by /admin/suggestions)
create table if not exists public.antonia_app_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggestion_type text not null default 'optimization' check (suggestion_type in ('feature', 'optimization', 'bug')),
  description text not null,
  context text,
  suggested_by_mission_id uuid references public.antonia_missions(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists antonia_app_suggestions_created_at_idx on public.antonia_app_suggestions(created_at desc);

-- === Observability: lead-level events ===

create table if not exists public.antonia_lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  mission_id uuid references public.antonia_missions(id) on delete set null,
  task_id text,
  lead_id uuid references public.leads(id) on delete cascade,
  event_type text not null,
  stage text,
  outcome text,
  message text,
  meta jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='antonia_lead_events') then
    alter table public.antonia_lead_events
      add column if not exists organization_id uuid,
      add column if not exists mission_id uuid,
      add column if not exists task_id text,
      add column if not exists lead_id uuid,
      add column if not exists event_type text,
      add column if not exists stage text,
      add column if not exists outcome text,
      add column if not exists message text,
      add column if not exists meta jsonb,
      add column if not exists created_at timestamptz default now();
  end if;
end $$;

create index if not exists antonia_lead_events_mission_created_at_idx on public.antonia_lead_events(mission_id, created_at desc);
create index if not exists antonia_lead_events_lead_created_at_idx on public.antonia_lead_events(lead_id, created_at desc);
create index if not exists antonia_lead_events_task_id_idx on public.antonia_lead_events(task_id);

-- === Lead table additive fields (for quick filtering in UI) ===
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='leads') then
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='last_contacted_at') then
      alter table public.leads add column last_contacted_at timestamptz;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='last_investigated_at') then
      alter table public.leads add column last_investigated_at timestamptz;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='last_enrichment_attempt_at') then
      alter table public.leads add column last_enrichment_attempt_at timestamptz;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='enrichment_error') then
      alter table public.leads add column enrichment_error text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='investigation_error') then
      alter table public.leads add column investigation_error text;
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='mission_id') then
    execute 'create index if not exists leads_mission_id_status_created_at_idx on public.leads(mission_id, status, created_at desc)';
  end if;
end $$;

-- === RLS policies (hybrid access: org membership) ===

alter table public.antonia_config enable row level security;
alter table public.antonia_missions enable row level security;
alter table public.antonia_tasks enable row level security;
alter table public.antonia_logs enable row level security;
alter table public.antonia_reports enable row level security;
alter table public.antonia_daily_usage enable row level security;
alter table public.antonia_usage_increments enable row level security;
alter table public.antonia_app_suggestions enable row level security;
alter table public.antonia_lead_events enable row level security;

-- antonia_config
drop policy if exists "Org members can view antonia_config" on public.antonia_config;
create policy "Org members can view antonia_config" on public.antonia_config
  for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

drop policy if exists "Org members can insert antonia_config" on public.antonia_config;
create policy "Org members can insert antonia_config" on public.antonia_config
  for insert
  with check (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

drop policy if exists "Org members can update antonia_config" on public.antonia_config;
create policy "Org members can update antonia_config" on public.antonia_config
  for update
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- antonia_missions
drop policy if exists "Org members can view antonia_missions" on public.antonia_missions;
create policy "Org members can view antonia_missions" on public.antonia_missions
  for select
  using (
    (user_id = auth.uid())
    or (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()))
  );

drop policy if exists "Org members can insert antonia_missions" on public.antonia_missions;
create policy "Org members can insert antonia_missions" on public.antonia_missions
  for insert
  with check (
    (user_id = auth.uid())
    and (organization_id is null or organization_id in (select organization_id from public.organization_members where user_id = auth.uid()))
  );

drop policy if exists "Org members can update antonia_missions" on public.antonia_missions;
create policy "Org members can update antonia_missions" on public.antonia_missions
  for update
  using (
    (user_id = auth.uid())
    or (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()))
  );

drop policy if exists "Org members can delete antonia_missions" on public.antonia_missions;
create policy "Org members can delete antonia_missions" on public.antonia_missions
  for delete
  using (
    (user_id = auth.uid())
    or (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()))
  );

-- antonia_tasks
drop policy if exists "Org members can view antonia_tasks" on public.antonia_tasks;
create policy "Org members can view antonia_tasks" on public.antonia_tasks
  for select
  using (
    (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()))
    or exists (select 1 from public.antonia_missions m where m.id = antonia_tasks.mission_id and m.user_id = auth.uid())
  );

-- Only allow user-created tasks for safe types (worker uses service role and bypasses RLS)
drop policy if exists "Org members can insert antonia_tasks" on public.antonia_tasks;
create policy "Org members can insert antonia_tasks" on public.antonia_tasks
  for insert
  with check (
    (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()))
    and (type in ('GENERATE_REPORT'))
  );

-- antonia_logs
drop policy if exists "Org members can view antonia_logs" on public.antonia_logs;
create policy "Org members can view antonia_logs" on public.antonia_logs
  for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- antonia_reports
drop policy if exists "Org members can view antonia_reports" on public.antonia_reports;
create policy "Org members can view antonia_reports" on public.antonia_reports
  for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- antonia_daily_usage
drop policy if exists "Org members can view antonia_daily_usage" on public.antonia_daily_usage;
create policy "Org members can view antonia_daily_usage" on public.antonia_daily_usage
  for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- antonia_usage_increments
drop policy if exists "Org members can view antonia_usage_increments" on public.antonia_usage_increments;
create policy "Org members can view antonia_usage_increments" on public.antonia_usage_increments
  for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- antonia_app_suggestions
-- Admin-only: allow owners/admins of the mission's organization to view + mark read.
drop policy if exists "Org admins can view antonia_app_suggestions" on public.antonia_app_suggestions;
create policy "Org admins can view antonia_app_suggestions" on public.antonia_app_suggestions
  for select
  using (
    exists (
      select 1
      from public.antonia_missions m
      join public.organization_members om on om.organization_id = m.organization_id
      where m.id = antonia_app_suggestions.suggested_by_mission_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

drop policy if exists "Org admins can update antonia_app_suggestions" on public.antonia_app_suggestions;
create policy "Org admins can update antonia_app_suggestions" on public.antonia_app_suggestions
  for update
  using (
    exists (
      select 1
      from public.antonia_missions m
      join public.organization_members om on om.organization_id = m.organization_id
      where m.id = antonia_app_suggestions.suggested_by_mission_id
        and om.user_id = auth.uid()
        and om.role in ('owner', 'admin')
    )
  );

-- antonia_lead_events
drop policy if exists "Org members can view antonia_lead_events" on public.antonia_lead_events;
create policy "Org members can view antonia_lead_events" on public.antonia_lead_events
  for select
  using (organization_id in (select organization_id from public.organization_members where user_id = auth.uid()));

-- === RPC: atomic daily usage increment ===

-- Drop old signature if it exists (text date)
drop function if exists public.increment_daily_usage(uuid, text, integer, integer, integer, integer);

create or replace function public.increment_daily_usage(
  p_organization_id uuid,
  p_date date,
  p_leads_searched integer default 0,
  p_search_runs integer default 0,
  p_leads_enriched integer default 0,
  p_leads_investigated integer default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.antonia_daily_usage (
    organization_id,
    date,
    leads_searched,
    search_runs,
    leads_enriched,
    leads_investigated,
    updated_at
  ) values (
    p_organization_id,
    p_date,
    greatest(p_leads_searched, 0),
    greatest(p_search_runs, 0),
    greatest(p_leads_enriched, 0),
    greatest(p_leads_investigated, 0),
    now()
  )
  on conflict (organization_id, date) do update set
    leads_searched = public.antonia_daily_usage.leads_searched + excluded.leads_searched,
    search_runs = public.antonia_daily_usage.search_runs + excluded.search_runs,
    leads_enriched = public.antonia_daily_usage.leads_enriched + excluded.leads_enriched,
    leads_investigated = public.antonia_daily_usage.leads_investigated + excluded.leads_investigated,
    updated_at = now();
$$;

revoke all on function public.increment_daily_usage(uuid, date, integer, integer, integer, integer) from public;
grant execute on function public.increment_daily_usage(uuid, date, integer, integer, integer, integer) to service_role;

-- === RPC: atomic task claim (queue) ===

create or replace function public.claim_antonia_tasks(
  p_limit integer default 5,
  p_worker_id text default null,
  p_worker_source text default null
)
returns setof public.antonia_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with cte as (
    select id
    from public.antonia_tasks
    where status = 'pending'
      and (scheduled_for is null or scheduled_for <= v_now)
    order by created_at asc
    for update skip locked
    limit greatest(p_limit, 0)
  )
  update public.antonia_tasks t
    set status = 'processing',
        processing_started_at = v_now,
        heartbeat_at = v_now,
        worker_id = coalesce(p_worker_id, t.worker_id),
        worker_source = coalesce(p_worker_source, t.worker_source),
        updated_at = v_now
  from cte
  where t.id = cte.id
  returning t.*;
end;
$$;

revoke all on function public.claim_antonia_tasks(integer, text, text) from public;
grant execute on function public.claim_antonia_tasks(integer, text, text) to service_role;

-- === RPC: schedule daily tasks for active missions ===
-- Idempotent and safe to call frequently.

-- Drop previous return type if present
drop function if exists public.schedule_daily_mission_tasks();

create or replace function public.schedule_daily_mission_tasks()
returns table (mission_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  r record;
  v_has_saved boolean;
  v_has_pending boolean;
  v_searches_today integer;
  v_limit integer;
begin
  for r in
    select id, organization_id, user_id, title, params, daily_search_limit
    from public.antonia_missions
    where status = 'active'
  loop
    -- If there are pending/processing tasks due now, don't schedule new ones.
    select exists(
      select 1 from public.antonia_tasks t
      where t.mission_id = r.id
        and t.status in ('pending', 'processing')
        and (t.scheduled_for is null or t.scheduled_for <= now())
    ) into v_has_pending;

    if v_has_pending then
      continue;
    end if;

    -- Prefer enriching from queue if there are saved leads.
    select exists(
      select 1 from public.leads l
      where l.mission_id = r.id
        and l.status = 'saved'
    ) into v_has_saved;

    if v_has_saved then
      insert into public.antonia_tasks (mission_id, organization_id, type, status, payload, idempotency_key, created_at)
      values (
        r.id,
        r.organization_id,
        'ENRICH',
        'pending',
        jsonb_build_object(
          'userId', r.user_id,
          'source', 'queue',
          'enrichmentLevel', coalesce(r.params->>'enrichmentLevel', 'basic'),
          'campaignName', coalesce(r.params->>'campaignName', case when coalesce((r.params->>'autoGenerateCampaign')::boolean, false) then 'Mision: ' || r.title else null end)
        ),
        'mission_' || r.id::text || '_enrich_' || v_today,
        now()
      )
      on conflict do nothing;

      mission_id := r.id;
      return next;
      continue;
    end if;

    -- Otherwise, schedule SEARCH up to mission daily_search_limit.
    select count(*)::integer
      from public.antonia_tasks t
      where t.mission_id = r.id
        and t.type = 'SEARCH'
        and t.created_at >= (date_trunc('day', now() at time zone 'utc'))
    into v_searches_today;

    v_limit := least(5, greatest(coalesce(r.daily_search_limit, 1), 1));
    if v_searches_today >= v_limit then
      continue;
    end if;

    insert into public.antonia_tasks (mission_id, organization_id, type, status, payload, idempotency_key, created_at)
    values (
      r.id,
      r.organization_id,
      'SEARCH',
      'pending',
      jsonb_build_object(
        'userId', r.user_id,
        'jobTitle', r.params->>'jobTitle',
        'location', r.params->>'location',
        'industry', r.params->>'industry',
        'keywords', coalesce(r.params->>'keywords', ''),
        'companySize', coalesce(r.params->>'companySize', ''),
        'seniorities', coalesce(r.params->'seniorities', '[]'::jsonb),
        'enrichmentLevel', coalesce(r.params->>'enrichmentLevel', 'basic'),
        'campaignName', coalesce(r.params->>'campaignName', case when coalesce((r.params->>'autoGenerateCampaign')::boolean, false) then 'Mision: ' || r.title else null end),
        'campaignContext', coalesce(r.params->>'campaignContext', ''),
        'missionTitle', r.title
      ),
      'mission_' || r.id::text || '_search_' || v_today || '_' || (v_searches_today + 1)::text,
      now()
    )
    on conflict do nothing;

    mission_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function public.schedule_daily_mission_tasks() from public;
grant execute on function public.schedule_daily_mission_tasks() to service_role;

-- Refresh schema cache (PostgREST)
notify pgrst, 'reload config';
