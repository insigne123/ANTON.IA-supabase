-- Canonical append-only activity ledger for backend observability and usage mining.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto;
  end if;
end $$;

create table if not exists public.antonia_event_ledger (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  event_type text not null,
  event_version integer not null default 1,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  organization_id uuid references public.organizations(id) on delete set null,
  organization_ref text,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_ref text,
  initiated_by_user_id uuid references auth.users(id) on delete set null,
  initiated_by_ref text,
  actor_type text not null default 'system',

  entity_type text,
  entity_id text,
  lead_id text,
  external_entity_id text,
  mission_id text,
  task_id text,
  campaign_id text,
  campaign_step_id text,
  contacted_id text,
  research_job_id text,
  dispatch_id text,

  source_system text not null default 'antonia',
  source_route text,
  provider text,
  provider_request_id text,

  request_id text,
  correlation_id text,
  causation_id text,
  operation_id text,
  idempotency_key text,
  attempt_number integer not null default 1,

  status text,
  outcome text,
  severity text,
  error_code text,
  duration_ms integer,
  metrics jsonb not null default '{}'::jsonb,
  redacted_payload jsonb not null default '{}'::jsonb,
  payload_hash text,

  source_confidence text not null default 'observed',
  privacy_class text not null default 'operational',
  payload_retention_until timestamptz not null default (now() + interval '90 days'),
  retention_until timestamptz not null default (now() + interval '24 months'),
  message text,
  created_at timestamptz not null default now(),

  constraint antonia_event_ledger_event_key_check
    check (length(trim(event_key)) between 1 and 300),
  constraint antonia_event_ledger_event_type_check
    check (length(trim(event_type)) between 1 and 150),
  constraint antonia_event_ledger_actor_type_check
    check (actor_type in ('user', 'agent', 'worker', 'cron', 'webhook', 'provider', 'system')),
  constraint antonia_event_ledger_attempt_check
    check (attempt_number > 0),
  constraint antonia_event_ledger_metrics_check
    check (jsonb_typeof(metrics) = 'object'),
  constraint antonia_event_ledger_payload_check
    check (jsonb_typeof(redacted_payload) = 'object'),
  constraint antonia_event_ledger_confidence_check
    check (source_confidence in ('observed', 'derived', 'backfill', 'unknown_actor')),
  constraint antonia_event_ledger_privacy_check
    check (privacy_class in ('operational', 'sensitive', 'redacted'))
);

alter table public.antonia_event_ledger
  add column if not exists payload_retention_until timestamptz not null default (now() + interval '90 days'),
  add column if not exists retention_until timestamptz not null default (now() + interval '24 months');

create unique index if not exists antonia_event_ledger_event_key_uidx
  on public.antonia_event_ledger(event_key);

create index if not exists antonia_event_ledger_org_occurred_idx
  on public.antonia_event_ledger(organization_id, occurred_at desc);

create index if not exists antonia_event_ledger_actor_occurred_idx
  on public.antonia_event_ledger(actor_user_id, occurred_at desc);

create index if not exists antonia_event_ledger_type_occurred_idx
  on public.antonia_event_ledger(event_type, occurred_at desc);

create index if not exists antonia_event_ledger_entity_idx
  on public.antonia_event_ledger(entity_type, entity_id, occurred_at desc);

create index if not exists antonia_event_ledger_correlation_idx
  on public.antonia_event_ledger(correlation_id, occurred_at desc)
  where correlation_id is not null;

create index if not exists antonia_event_ledger_provider_idx
  on public.antonia_event_ledger(provider, source_system, occurred_at desc)
  where provider is not null;

create index if not exists antonia_event_ledger_retention_idx
  on public.antonia_event_ledger(retention_until)
  where retention_until is not null;

create index if not exists antonia_event_ledger_payload_retention_idx
  on public.antonia_event_ledger(payload_retention_until)
  where redacted_payload <> '{}'::jsonb;

create table if not exists public.antonia_provider_usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  scope_type text not null,
  provider_account_id text,
  provider_user_id text,
  cycle_start timestamptz,
  cycle_end timestamptz,
  usage jsonb not null default '{}'::jsonb,
  source text not null default 'provider_api',
  request_id text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint antonia_provider_usage_scope_check
    check (scope_type in ('team', 'user')),
  constraint antonia_provider_usage_json_check
    check (jsonb_typeof(usage) = 'object')
);

create index if not exists antonia_provider_usage_snapshots_provider_idx
  on public.antonia_provider_usage_snapshots(provider, captured_at desc);

create index if not exists antonia_provider_usage_snapshots_cycle_idx
  on public.antonia_provider_usage_snapshots(provider, cycle_start, cycle_end, captured_at desc);

-- Backfill existing operational streams without copying their potentially sensitive payloads.
do $$
begin
  if to_regclass('public.antonia_lead_events') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_type, entity_type, entity_id, lead_id, mission_id, task_id,
      source_system, causation_id, status, outcome, message, metrics,
      redacted_payload, source_confidence
    )
    select
      'backfill:antonia_lead_event:' || e.id::text,
      left('backfill.lead.' || coalesce(nullif(trim(e.event_type), ''), 'unknown'), 150),
      coalesce(e.created_at, now()),
      e.organization_id,
      e.organization_id::text,
      'worker',
      'lead',
      e.lead_id::text,
      e.lead_id::text,
      e.mission_id::text,
      e.task_id,
      'antonia_lead_events',
      e.id::text,
      e.stage,
      e.outcome,
      left(regexp_replace(coalesce(e.message, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[EMAIL_REDACTED]', 'gi'), 500),
      jsonb_build_object('stage', e.stage, 'outcome', e.outcome),
      '{}'::jsonb,
      'backfill'
    from public.antonia_lead_events e
    where e.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.antonia_logs') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_type, entity_type, entity_id, mission_id, source_system,
      causation_id, status, outcome, message, metrics, redacted_payload,
      source_confidence
    )
    select
      'backfill:antonia_log:' || l.id::text,
      left('backfill.antonia_log.' || coalesce(nullif(trim(l.level), ''), 'info'), 150),
      coalesce(l.created_at, now()),
      l.organization_id,
      l.organization_id::text,
      'worker',
      'mission',
      l.mission_id::text,
      l.mission_id::text,
      'antonia_logs',
      l.id::text,
      l.level,
      l.level,
      left(regexp_replace(coalesce(l.message, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[EMAIL_REDACTED]', 'gi'), 500),
      jsonb_build_object('level', l.level),
      '{}'::jsonb,
      'backfill'
    from public.antonia_logs l
    where l.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.activity_logs') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_user_id, actor_ref, actor_type, entity_type, entity_id,
      source_system, causation_id, status, outcome, metrics, redacted_payload,
      source_confidence
    )
    select
      'backfill:activity_log:' || a.id::text,
      left('backfill.activity.' || coalesce(nullif(trim(a.action), ''), 'unknown'), 150),
      coalesce(a.created_at, now()),
      a.organization_id,
      a.organization_id::text,
      a.user_id,
      a.user_id::text,
      'user',
      a.entity_type,
      a.entity_id::text,
      'activity_logs',
      a.id::text,
      'recorded',
      a.action,
      jsonb_build_object('action', a.action),
      '{}'::jsonb,
      case when a.user_id is null then 'unknown_actor' else 'backfill' end
    from public.activity_logs a
    where a.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.antonia_tasks') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_type, entity_type, entity_id, mission_id, task_id, source_system,
      causation_id, status, outcome, error_code, message, metrics,
      redacted_payload, source_confidence
    )
    select
      'backfill:antonia_task:' || t.id::text || ':' || coalesce(t.updated_at, t.created_at, now())::text,
      left('backfill.task.' || coalesce(nullif(trim(t.status), ''), 'unknown'), 150),
      coalesce(t.updated_at, t.created_at, now()),
      t.organization_id,
      t.organization_id::text,
      'worker',
      'task',
      t.id::text,
      t.mission_id::text,
      t.id::text,
      'antonia_tasks',
      t.id::text,
      t.status,
      t.status,
      case when nullif(trim(t.error_message), '') is null then null else 'historical_task_error' end,
      left(regexp_replace(coalesce(t.error_message, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[EMAIL_REDACTED]', 'gi'), 500),
      jsonb_build_object('taskType', t.type, 'retryCount', coalesce(t.retry_count, 0)),
      '{}'::jsonb,
      'backfill'
    from public.antonia_tasks t
    where t.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.email_events') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_user_id, actor_ref, actor_type, entity_type, entity_id, lead_id,
      contacted_id, mission_id, source_system, provider, provider_request_id,
      status, outcome, metrics, redacted_payload, source_confidence
    )
    select
      'backfill:email_event:' || e.id::text,
      left('backfill.email.' || coalesce(nullif(trim(e.event_type), ''), 'unknown'), 150),
      coalesce(e.event_at, e.created_at, now()),
      coalesce(e.organization_id, c.organization_id),
      coalesce(e.organization_id, c.organization_id)::text,
      c.user_id,
      c.user_id::text,
      case when c.user_id is null then 'system' else 'user' end,
      'email_event',
      e.id::text,
      e.lead_id,
      e.contacted_id,
      e.mission_id::text,
      'email_events',
      e.provider,
      coalesce(e.message_id, e.internet_message_id),
      'recorded',
      e.event_type,
      jsonb_build_object('eventSource', e.event_source, 'hasThreadKey', e.thread_key is not null),
      '{}'::jsonb,
      case when c.user_id is null then 'unknown_actor' else 'backfill' end
    from public.email_events e
    left join public.contacted_leads c on c.id::text = e.contacted_id::text
    where e.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.outbound_dispatches') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_user_id, actor_ref, actor_type, entity_type, entity_id, dispatch_id,
      source_system, operation_id, idempotency_key, provider, provider_request_id,
      status, outcome, error_code, message, metrics, redacted_payload,
      source_confidence
    )
    select
      'backfill:outbound_dispatch:' || d.id::text || ':' || coalesce(d.updated_at, d.created_at, now())::text,
      left('backfill.contact.dispatch.' || coalesce(nullif(trim(d.status), ''), 'unknown'), 150),
      coalesce(d.updated_at, d.created_at, now()),
      d.organization_id,
      d.organization_id::text,
      d.user_id,
      d.user_id::text,
      'user',
      'outbound_dispatch',
      d.id::text,
      d.id::text,
      'outbound_dispatches',
      d.idempotency_key,
      d.idempotency_key,
      d.provider,
      d.provider_message_id,
      d.status,
      d.status,
      d.error_code,
      left(regexp_replace(coalesce(d.error_message, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[EMAIL_REDACTED]', 'gi'), 500),
      jsonb_build_object('channel', d.channel, 'attemptCount', coalesce(d.attempt_count, 0)),
      '{}'::jsonb,
      'backfill'
    from public.outbound_dispatches d
    where d.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.lead_research_jobs') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, organization_id, organization_ref,
      actor_user_id, actor_ref, actor_type, entity_type, entity_id,
      research_job_id, external_entity_id, source_system, provider,
      provider_request_id, status, outcome, metrics, redacted_payload,
      source_confidence
    )
    select
      'backfill:lead_research_job:' || j.id::text || ':' || coalesce(j.updated_at, j.created_at, now())::text,
      left('backfill.research.' || coalesce(nullif(trim(j.status), ''), 'unknown'), 150),
      coalesce(j.updated_at, j.created_at, now()),
      j.organization_id,
      j.organization_id::text,
      j.user_id,
      j.user_id::text,
      'user',
      'research_job',
      j.id::text,
      j.id::text,
      j.provider_report_id,
      'lead-research',
      j.provider,
      j.provider_report_id,
      j.status,
      j.status,
      jsonb_build_object('scopeKey', j.scope_key),
      '{}'::jsonb,
      'backfill'
    from public.lead_research_jobs j
    where j.id is not null
    on conflict (event_key) do nothing;
  end if;

  if to_regclass('public.people_search_leads') is not null then
    insert into public.antonia_event_ledger (
      event_key, event_type, occurred_at, actor_type, entity_type, entity_id,
      source_system, outcome, metrics, redacted_payload, source_confidence
    )
    select
      'backfill:people_search_batch:' || md5(coalesce(nullif(trim(p.batch_run_id::text), ''), 'unknown')),
      'backfill.search.results_persisted',
      now(),
      'system',
      'search_batch',
      coalesce(nullif(trim(p.batch_run_id::text), ''), 'unknown'),
      'people_search_leads',
      'historical_results',
      jsonb_build_object('resultCount', count(*), 'batchRunIdKnown', coalesce(nullif(trim(p.batch_run_id::text), ''), 'unknown') <> 'unknown'),
      '{}'::jsonb,
      'unknown_actor'
    from public.people_search_leads p
    group by coalesce(nullif(trim(p.batch_run_id::text), ''), 'unknown')
    on conflict (event_key) do nothing;
  end if;
end;
$$;

alter table public.antonia_event_ledger enable row level security;
alter table public.antonia_provider_usage_snapshots enable row level security;

revoke all on table public.antonia_event_ledger from public, anon, authenticated;
revoke all on table public.antonia_provider_usage_snapshots from public, anon, authenticated;
grant select on table public.antonia_event_ledger to service_role;
grant select, insert on table public.antonia_provider_usage_snapshots to service_role;

create or replace function public.antonia_event_ledger_block_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE'
     and current_setting('app.antonia_event_ledger_redaction', true) = 'on' then
    return NEW;
  end if;
  raise exception 'antonia_event_ledger is append-only';
end;
$$;

drop trigger if exists antonia_event_ledger_no_update_delete on public.antonia_event_ledger;
create trigger antonia_event_ledger_no_update_delete
  before update or delete on public.antonia_event_ledger
  for each row execute function public.antonia_event_ledger_block_mutation();

create or replace function public.antonia_event_uuid_or_null(p_value text)
returns uuid
language sql
immutable
as $$
  select case
    when coalesce(trim(p_value), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then trim(p_value)::uuid
    else null
  end;
$$;

create or replace function public.append_antonia_event_v1(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_key text := nullif(trim(p_event->>'event_key'), '');
  v_event_type text := nullif(trim(p_event->>'event_type'), '');
  v_id uuid;
  v_created boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'event must be a JSON object' using errcode = '22023';
  end if;

  if v_event_key is null or v_event_type is null then
    raise exception 'event_key and event_type are required' using errcode = '22023';
  end if;

  insert into public.antonia_event_ledger (
    event_key,
    event_type,
    event_version,
    occurred_at,
    organization_id,
    organization_ref,
    actor_user_id,
    actor_ref,
    initiated_by_user_id,
    initiated_by_ref,
    actor_type,
    entity_type,
    entity_id,
    lead_id,
    external_entity_id,
    mission_id,
    task_id,
    campaign_id,
    campaign_step_id,
    contacted_id,
    research_job_id,
    dispatch_id,
    source_system,
    source_route,
    provider,
    provider_request_id,
    request_id,
    correlation_id,
    causation_id,
    operation_id,
    idempotency_key,
    attempt_number,
    status,
    outcome,
    severity,
    error_code,
    duration_ms,
    metrics,
    redacted_payload,
    payload_hash,
    source_confidence,
    privacy_class,
    payload_retention_until,
    retention_until,
    message
  ) values (
    v_event_key,
    v_event_type,
    greatest(1, coalesce(nullif(p_event->>'event_version', '')::integer, 1)),
    coalesce(nullif(p_event->>'occurred_at', '')::timestamptz, now()),
    public.antonia_event_uuid_or_null(p_event->>'organization_id'),
    nullif(trim(p_event->>'organization_id'), ''),
    public.antonia_event_uuid_or_null(p_event->>'actor_user_id'),
    nullif(trim(p_event->>'actor_id'), ''),
    public.antonia_event_uuid_or_null(p_event->>'initiated_by_user_id'),
    nullif(trim(p_event->>'initiated_by_user_id'), ''),
    coalesce(nullif(trim(p_event->>'actor_type'), ''), 'system'),
    nullif(trim(p_event->>'entity_type'), ''),
    nullif(trim(p_event->>'entity_id'), ''),
    nullif(trim(p_event->>'lead_id'), ''),
    nullif(trim(p_event->>'external_entity_id'), ''),
    nullif(trim(p_event->>'mission_id'), ''),
    nullif(trim(p_event->>'task_id'), ''),
    nullif(trim(p_event->>'campaign_id'), ''),
    nullif(trim(p_event->>'campaign_step_id'), ''),
    nullif(trim(p_event->>'contacted_id'), ''),
    nullif(trim(p_event->>'research_job_id'), ''),
    nullif(trim(p_event->>'dispatch_id'), ''),
    coalesce(nullif(trim(p_event->>'source_system'), ''), 'antonia'),
    nullif(trim(p_event->>'source_route'), ''),
    nullif(trim(p_event->>'provider'), ''),
    nullif(trim(p_event->>'provider_request_id'), ''),
    nullif(trim(p_event->>'request_id'), ''),
    nullif(trim(p_event->>'correlation_id'), ''),
    nullif(trim(p_event->>'causation_id'), ''),
    nullif(trim(p_event->>'operation_id'), ''),
    nullif(trim(p_event->>'idempotency_key'), ''),
    greatest(1, coalesce(nullif(p_event->>'attempt_number', '')::integer, 1)),
    nullif(trim(p_event->>'status'), ''),
    nullif(trim(p_event->>'outcome'), ''),
    nullif(trim(p_event->>'severity'), ''),
    nullif(trim(p_event->>'error_code'), ''),
    nullif(p_event->>'duration_ms', '')::integer,
    case when jsonb_typeof(p_event->'metrics') = 'object' then p_event->'metrics' else '{}'::jsonb end,
    case when jsonb_typeof(p_event->'redacted_payload') = 'object' then p_event->'redacted_payload' else '{}'::jsonb end,
    nullif(trim(p_event->>'payload_hash'), ''),
    coalesce(nullif(trim(p_event->>'source_confidence'), ''), 'observed'),
    coalesce(nullif(trim(p_event->>'privacy_class'), ''), 'operational'),
    coalesce(nullif(p_event->>'payload_retention_until', '')::timestamptz, now() + interval '90 days'),
    coalesce(nullif(p_event->>'retention_until', '')::timestamptz, now() + interval '24 months'),
    nullif(trim(p_event->>'message'), '')
  )
  on conflict (event_key) do nothing
  returning id into v_id;

  if v_id is not null then
    v_created := true;
  else
    select id into v_id
    from public.antonia_event_ledger
    where event_key = v_event_key;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'event_key', v_event_key,
    'created', v_created
  );
end;
$$;

create or replace function public.query_antonia_event_ledger_v1(
  p_organization_id uuid default null,
  p_actor_user_id uuid default null,
  p_event_type text default null,
  p_entity_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 200
)
returns setof public.antonia_event_ledger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select e.*
  from public.antonia_event_ledger e
  where (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_actor_user_id is null or e.actor_user_id = p_actor_user_id)
    and (p_event_type is null or e.event_type = nullif(trim(p_event_type), ''))
    and (p_entity_type is null or e.entity_type = nullif(trim(p_entity_type), ''))
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at < p_to)
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

create or replace function public.summarize_antonia_events_v1(
  p_organization_id uuid default null,
  p_actor_user_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  event_type text,
  provider text,
  status text,
  outcome text,
  event_count bigint,
  first_occurred_at timestamptz,
  last_occurred_at timestamptz,
  total_duration_ms bigint
)
language sql
security definer
set search_path = public
as $$
  select
    e.event_type,
    e.provider,
    e.status,
    e.outcome,
    count(*)::bigint,
    min(e.occurred_at),
    max(e.occurred_at),
    coalesce(sum(e.duration_ms), 0)::bigint
  from public.antonia_event_ledger e
  where coalesce(auth.role(), '') = 'service_role'
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_actor_user_id is null or e.actor_user_id = p_actor_user_id)
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at < p_to)
  group by e.event_type, e.provider, e.status, e.outcome
  order by count(*) desc, e.event_type;
$$;

create or replace function public.redact_antonia_event_v1(
  p_event_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform set_config('app.antonia_event_ledger_redaction', 'on', true);

  update public.antonia_event_ledger
  set actor_user_id = null,
      initiated_by_user_id = null,
      redacted_payload = '{}'::jsonb,
      metrics = jsonb_build_object('redacted', true),
      payload_hash = null,
      privacy_class = 'redacted',
      message = left(coalesce(nullif(trim(p_reason), ''), 'privacy_redaction'), 500),
      recorded_at = now()
  where id = p_event_id;

  return found;
end;
$$;

create or replace function public.redact_expired_antonia_event_payloads_v1(
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redacted integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'invalid redaction limit' using errcode = '22023';
  end if;

  perform set_config('app.antonia_event_ledger_redaction', 'on', true);

  with candidates as (
    select id
    from public.antonia_event_ledger
    where payload_retention_until <= now()
      and redacted_payload <> '{}'::jsonb
    order by payload_retention_until asc, id asc
    limit p_limit
  )
  update public.antonia_event_ledger e
  set redacted_payload = '{}'::jsonb,
      payload_hash = null,
      privacy_class = case when privacy_class = 'sensitive' then 'redacted' else privacy_class end,
      message = coalesce(message, 'payload_redacted_by_retention'),
      recorded_at = now()
  where e.id in (select id from candidates);

  get diagnostics v_redacted = row_count;
  return v_redacted;
end;
$$;

revoke all on function public.append_antonia_event_v1(jsonb) from public, anon, authenticated;
revoke all on function public.query_antonia_event_ledger_v1(uuid, uuid, text, text, timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.summarize_antonia_events_v1(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.redact_antonia_event_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.redact_expired_antonia_event_payloads_v1(integer) from public, anon, authenticated;
grant execute on function public.append_antonia_event_v1(jsonb) to service_role;
grant execute on function public.query_antonia_event_ledger_v1(uuid, uuid, text, text, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.summarize_antonia_events_v1(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.redact_antonia_event_v1(uuid, text) to service_role;
grant execute on function public.redact_expired_antonia_event_payloads_v1(integer) to service_role;

notify pgrst, 'reload schema';
