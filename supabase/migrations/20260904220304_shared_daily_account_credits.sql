-- Enforce one shared daily credit allowance per user across lead search,
-- enrichment, and investigation. Contact quotas and mission budgets remain separate.

alter table public.user_quota_overrides
  add column if not exists daily_credit_limit integer;

alter table public.user_quota_overrides
  drop constraint if exists user_quota_overrides_daily_credit_limit_check;

alter table public.user_quota_overrides
  add constraint user_quota_overrides_daily_credit_limit_check
    check (daily_credit_limit is null or daily_credit_limit between 1 and 50);

-- Preserve an existing lower entitlement instead of silently raising it when
-- the two legacy resource limits become one shared account limit.
update public.user_quota_overrides quota_override
set daily_credit_limit = case
  when coalesce(quota_override.daily_enrich_limit, 0) > 0
    and coalesce(quota_override.daily_investigate_limit, 0) > 0
    then least(50, quota_override.daily_enrich_limit, quota_override.daily_investigate_limit)
  when coalesce(quota_override.daily_enrich_limit, 0) > 0
    then least(50, quota_override.daily_enrich_limit)
  when coalesce(quota_override.daily_investigate_limit, 0) > 0
    then least(50, quota_override.daily_investigate_limit)
  else null
end
where quota_override.daily_credit_limit is null
  and (
    coalesce(quota_override.daily_enrich_limit, 0) > 0
    or coalesce(quota_override.daily_investigate_limit, 0) > 0
  );

create table if not exists public.antonia_user_daily_credits (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  usage_count integer not null default 0,
  search_count integer not null default 0,
  enrich_count integer not null default 0,
  investigate_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date),
  constraint antonia_user_daily_credits_counts_check check (
    usage_count >= 0
    and search_count >= 0
    and enrich_count >= 0
    and investigate_count >= 0
    and usage_count = search_count + enrich_count + investigate_count
  )
);

create index if not exists antonia_user_daily_credits_date_idx
  on public.antonia_user_daily_credits (date);

alter table public.antonia_user_daily_credits enable row level security;
revoke all on table public.antonia_user_daily_credits from public, anon, authenticated;
grant select on table public.antonia_user_daily_credits to service_role;

create table if not exists public.antonia_suplia_research_credit_operations (
  tool_run_id uuid primary key references public.suplia_tool_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_day date not null,
  consumed_at timestamptz not null default now()
);

create index if not exists antonia_suplia_research_credit_operations_user_day_idx
  on public.antonia_suplia_research_credit_operations (user_id, quota_day);

alter table public.antonia_suplia_research_credit_operations enable row level security;
revoke all on table public.antonia_suplia_research_credit_operations from public, anon, authenticated;
grant select on table public.antonia_suplia_research_credit_operations to service_role;

-- Completed premium research calls predate the private reservation ledger.
-- Backfill only successes because older failures do not prove provider use.
insert into public.antonia_suplia_research_credit_operations (
  tool_run_id, organization_id, user_id, quota_day, consumed_at
)
select run.id,
       run.organization_id,
       run.user_id,
       timezone('utc', coalesce(run.finished_at, run.started_at, run.created_at))::date,
       coalesce(run.finished_at, run.started_at, run.created_at)
from public.suplia_tool_runs run
where run.user_id is not null
  and run.status = 'completed'
  and run.tool_name in (
    'research.brand',
    'research.brand_mentions',
    'research.serp_company_news',
    'research.serp_competitors',
    'research.serp_jobs_signals'
  )
  and timezone('utc', coalesce(run.finished_at, run.started_at, run.created_at))::date = timezone('utc', now())::date
on conflict (tool_run_id) do nothing;

-- Preserve today's attributable usage during cutover. Legacy user counters can
-- duplicate operation/job ledgers, while operation and research-job ledgers
-- describe distinct work and must be added together.
with resource_sources as (
  select usage.user_id,
         usage.date,
         case
           when usage.resource = 'enrich' then 'legacy_enrich'
           else 'legacy_investigate'
         end as source_kind,
         sum(usage.usage_count)::integer as amount
  from public.antonia_user_daily_usage usage
  where usage.date = timezone('utc', now())::date
    and usage.resource in ('enrich', 'investigate')
  group by usage.user_id, usage.date, usage.resource

  union all

  select operation.user_id,
         operation.quota_day,
         case
           when operation.resource = 'enrich' then 'operation_enrich'
           else 'operation_investigate'
         end as source_kind,
         sum(operation.consumed_count)::integer as amount
  from public.antonia_quota_operations operation
  where operation.quota_day = timezone('utc', now())::date
    and operation.quota_allowed
    and operation.resource in ('enrich', 'investigate')
  group by operation.user_id, operation.quota_day, operation.resource

  union all

  select job.user_id,
         job.quota_day,
         'research_job'::text as source_kind,
         count(*)::integer as amount
  from public.lead_research_jobs job
  where job.quota_day = timezone('utc', now())::date
    and job.quota_consumed_at is not null
  group by job.user_id, job.quota_day

  union all

  select event.actor_user_id,
         timezone('utc', event.occurred_at)::date,
         'search'::text as source_kind,
         sum(
           case
             when coalesce(event.metrics ->> 'requestedCount', '') ~ '^[0-9]+$'
               then greatest(1, (event.metrics ->> 'requestedCount')::integer)
             else 1
           end
         )::integer as amount
  from public.antonia_event_ledger event
  where event.actor_user_id is not null
    and timezone('utc', event.occurred_at)::date = timezone('utc', now())::date
    and event.event_type = 'quota.reserved'
    and event.status = 'allowed'
    and event.metrics ->> 'resource' in ('search', 'leadSearch')
  group by event.actor_user_id, timezone('utc', event.occurred_at)::date

  union all

  select operation.user_id,
         operation.quota_day,
         'suplia_investigate'::text as source_kind,
         count(*)::integer as amount
  from public.antonia_suplia_research_credit_operations operation
  where operation.quota_day = timezone('utc', now())::date
  group by operation.user_id, operation.quota_day
), resource_totals as (
  select source.user_id,
         source.date,
         source.source_kind,
         greatest(0, max(source.amount))::integer as amount
  from resource_sources source
  where source.user_id is not null and source.date is not null
  group by source.user_id, source.date, source.source_kind
), user_totals as (
  select total.user_id,
         total.date,
         coalesce(sum(total.amount) filter (where total.source_kind = 'search'), 0)::integer as search_count,
         greatest(
           coalesce(sum(total.amount) filter (where total.source_kind = 'legacy_enrich'), 0),
           coalesce(sum(total.amount) filter (where total.source_kind = 'operation_enrich'), 0)
         )::integer as enrich_count,
         (
           greatest(
             coalesce(sum(total.amount) filter (where total.source_kind = 'legacy_investigate'), 0),
             coalesce(sum(total.amount) filter (where total.source_kind = 'operation_investigate'), 0)
               + coalesce(sum(total.amount) filter (where total.source_kind = 'research_job'), 0)
           )
           + coalesce(sum(total.amount) filter (where total.source_kind = 'suplia_investigate'), 0)
         )::integer as investigate_count
  from resource_totals total
  group by total.user_id, total.date
)
insert into public.antonia_user_daily_credits (
  user_id, date, usage_count, search_count, enrich_count, investigate_count, updated_at
)
select total.user_id,
       total.date,
       total.search_count + total.enrich_count + total.investigate_count,
       total.search_count,
       total.enrich_count,
       total.investigate_count,
       now()
from user_totals total
on conflict (user_id, date) do update
set usage_count = greatest(
      public.antonia_user_daily_credits.search_count,
      excluded.search_count
    ) + greatest(
      public.antonia_user_daily_credits.enrich_count,
      excluded.enrich_count
    ) + greatest(
      public.antonia_user_daily_credits.investigate_count,
      excluded.investigate_count
    ),
    search_count = greatest(
      public.antonia_user_daily_credits.search_count,
      excluded.search_count
    ),
    enrich_count = greatest(
      public.antonia_user_daily_credits.enrich_count,
      excluded.enrich_count
    ),
    investigate_count = greatest(
      public.antonia_user_daily_credits.investigate_count,
      excluded.investigate_count
    ),
    updated_at = now();

-- Existing active reservations made today are represented in the shared
-- backfill above and must use the shared refund path from this point forward.
update public.antonia_quota_operations
set quota_scope = 'user', quota_limit = least(quota_limit, 50), updated_at = now()
where quota_day = timezone('utc', now())::date
  and quota_allowed
  and status in ('claimed', 'submitted');

update public.lead_research_jobs
set quota_scope = 'user', updated_at = now()
where quota_day = timezone('utc', now())::date
  and quota_consumed_at is not null
  and request_claim_state = 'pre_provider';

create or replace function public.consume_antonia_user_daily_credits_v1(
  p_user_id uuid,
  p_resource text,
  p_requested_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_day date := timezone('utc', now())::date;
  v_resource text := case
    when p_resource in ('leadSearch', 'search') then 'search'
    when p_resource = 'research' then 'investigate'
    else p_resource
  end;
  v_limit integer := 50;
  v_usage public.antonia_user_daily_credits%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id is null
    or v_resource not in ('search', 'enrich', 'investigate')
    or p_requested_count is null
    or p_requested_count <= 0 then
    raise exception 'invalid daily credit input' using errcode = '22023';
  end if;

  select least(50, coalesce(nullif(quota_override.daily_credit_limit, 0), 50))
  into v_limit
  from public.user_quota_overrides quota_override
  where quota_override.user_id = p_user_id;
  v_limit := coalesce(v_limit, 50);

  insert into public.antonia_user_daily_credits (user_id, date)
  values (p_user_id, v_day)
  on conflict (user_id, date) do nothing;

  select credits.*
  into v_usage
  from public.antonia_user_daily_credits credits
  where credits.user_id = p_user_id and credits.date = v_day
  for update;
  if not found then
    raise exception 'daily credit bucket is missing' using errcode = '55000';
  end if;

  if v_usage.usage_count > v_limit - p_requested_count then
    return jsonb_build_object(
      'allowed', false,
      'count', v_usage.usage_count,
      'limit', v_limit,
      'search_count', v_usage.search_count,
      'enrich_count', v_usage.enrich_count,
      'investigate_count', v_usage.investigate_count
    );
  end if;

  update public.antonia_user_daily_credits credits
  set usage_count = credits.usage_count + p_requested_count,
      search_count = credits.search_count + case when v_resource = 'search' then p_requested_count else 0 end,
      enrich_count = credits.enrich_count + case when v_resource = 'enrich' then p_requested_count else 0 end,
      investigate_count = credits.investigate_count + case when v_resource = 'investigate' then p_requested_count else 0 end,
      updated_at = now()
  where credits.user_id = p_user_id and credits.date = v_day
  returning * into v_usage;

  return jsonb_build_object(
    'allowed', true,
    'count', v_usage.usage_count,
    'limit', v_limit,
    'search_count', v_usage.search_count,
    'enrich_count', v_usage.enrich_count,
    'investigate_count', v_usage.investigate_count
  );
end;
$$;

create or replace function public.release_antonia_user_daily_credits_v1(
  p_user_id uuid,
  p_day date,
  p_resource text,
  p_released_count integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_resource text := case
    when p_resource in ('leadSearch', 'search') then 'search'
    when p_resource = 'research' then 'investigate'
    else p_resource
  end;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id is null
    or p_day is null
    or v_resource not in ('search', 'enrich', 'investigate')
    or p_released_count is null
    or p_released_count <= 0 then
    raise exception 'invalid daily credit release input' using errcode = '22023';
  end if;

  update public.antonia_user_daily_credits credits
  set usage_count = credits.usage_count - p_released_count,
      search_count = credits.search_count - case when v_resource = 'search' then p_released_count else 0 end,
      enrich_count = credits.enrich_count - case when v_resource = 'enrich' then p_released_count else 0 end,
      investigate_count = credits.investigate_count - case when v_resource = 'investigate' then p_released_count else 0 end,
      updated_at = now()
  where credits.user_id = p_user_id
    and credits.date = p_day
    and credits.usage_count >= p_released_count
    and credits.search_count >= case when v_resource = 'search' then p_released_count else 0 end
    and credits.enrich_count >= case when v_resource = 'enrich' then p_released_count else 0 end
    and credits.investigate_count >= case when v_resource = 'investigate' then p_released_count else 0 end;
  return found;
end;
$$;

create or replace function public.consume_suplia_research_tool_credit_v1(
  p_tool_run_id uuid,
  p_organization_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_day date := timezone('utc', now())::date;
  v_run public.suplia_tool_runs%rowtype;
  v_operation public.antonia_suplia_research_credit_operations%rowtype;
  v_quota jsonb;
  v_count integer;
  v_limit integer := 50;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_tool_run_id is null or p_organization_id is null or p_user_id is null then
    raise exception 'invalid SUPLIA research credit input' using errcode = '22023';
  end if;

  select run.*
  into v_run
  from public.suplia_tool_runs run
  where run.id = p_tool_run_id
    and run.organization_id = p_organization_id
    and run.user_id = p_user_id
    and run.status = 'running'
    and run.tool_name in (
      'research.brand',
      'research.brand_mentions',
      'research.serp_company_news',
      'research.serp_competitors',
      'research.serp_jobs_signals'
    )
  for update;
  if not found then
    raise exception 'SUPLIA premium research run is missing or not owned' using errcode = '55000';
  end if;

  select operation.*
  into v_operation
  from public.antonia_suplia_research_credit_operations operation
  where operation.tool_run_id = v_run.id;
  if found then
    if v_operation.organization_id <> p_organization_id or v_operation.user_id <> p_user_id then
      raise exception 'SUPLIA research credit operation identity changed' using errcode = '55000';
    end if;
    select credits.usage_count
    into v_count
    from public.antonia_user_daily_credits credits
    where credits.user_id = p_user_id and credits.date = v_operation.quota_day;
    if not found then
      raise exception 'shared credit bucket is missing for SUPLIA research replay' using errcode = '55000';
    end if;
    select least(50, coalesce(nullif(quota_override.daily_credit_limit, 0), 50))
    into v_limit
    from public.user_quota_overrides quota_override
    where quota_override.user_id = p_user_id;
    return jsonb_build_object(
      'allowed', true,
      'count', v_count,
      'limit', coalesce(v_limit, 50),
      'reused', true
    );
  end if;

  v_quota := public.consume_antonia_user_daily_credits_v1(p_user_id, 'investigate', 1);
  if coalesce((v_quota ->> 'allowed')::boolean, false) then
    insert into public.antonia_suplia_research_credit_operations (
      tool_run_id, organization_id, user_id, quota_day, consumed_at
    ) values (
      v_run.id, p_organization_id, p_user_id, v_day, now()
    );
  end if;
  return v_quota || jsonb_build_object('reused', false);
end;
$$;

create or replace function public.consume_antonia_daily_quota_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_scope text,
  p_resource text,
  p_requested_count integer,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_user_id is null
    or p_scope not in ('organization', 'user')
    or p_resource not in ('leadSearch', 'search', 'enrich', 'investigate', 'research')
    or p_requested_count is null
    or p_requested_count <= 0
    or p_limit is null
    or p_limit < 0 then
    raise exception 'invalid daily quota input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_user_id
  ) then
    raise exception 'quota user does not belong to organization' using errcode = '22023';
  end if;

  -- p_scope and p_limit remain in the signature for compatibility. The account
  -- limit is resolved inside the shared service-role boundary and never exceeds 50.
  return public.consume_antonia_user_daily_credits_v1(
    p_user_id, p_resource, p_requested_count
  );
end;
$$;

-- Keep enrichment claims idempotent while moving their reservation to the
-- account-wide bucket. The legacy scope and limit arguments remain only for
-- callers deployed before this migration.
create or replace function public.claim_antonia_quota_operation_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_scope text,
  p_resource text,
  p_operation_id text,
  p_request_fingerprint text,
  p_requested_count integer,
  p_limit integer,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_day date := timezone('utc', now())::date;
  v_operation public.antonia_quota_operations%rowtype;
  v_quota jsonb;
  v_claim_token uuid := gen_random_uuid();
  v_created boolean := false;
  v_claimed boolean := false;
  v_reused boolean := false;
  v_row_count integer := 0;
  v_allowed boolean := false;
  v_count integer := 0;
  v_limit integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null
    or p_scope not in ('organization', 'user')
    or p_resource not in ('enrich', 'investigate')
    or nullif(trim(coalesce(p_operation_id, '')), '') is null
    or length(trim(p_operation_id)) > 200
    or coalesce(lower(trim(p_request_fingerprint)), '') !~ '^[0-9a-f]{64}$'
    or p_requested_count is null or p_requested_count <= 0
    or p_limit is null or p_limit < 0
    or p_stale_after_seconds is null or p_stale_after_seconds < 60 then
    raise exception 'invalid quota operation claim input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_user_id
  ) then
    raise exception 'quota operation user does not belong to organization' using errcode = '22023';
  end if;

  insert into public.antonia_quota_operations (
    organization_id, user_id, resource, operation_id, request_fingerprint,
    requested_count, quota_scope, quota_day, quota_limit, status,
    claim_token, claimed_at, created_at, updated_at
  ) values (
    p_organization_id, p_user_id, p_resource, trim(p_operation_id), lower(trim(p_request_fingerprint)),
    p_requested_count, 'user', v_day, 50, 'claimed',
    v_claim_token, now(), now(), now()
  ) on conflict (organization_id, user_id, resource, operation_id) do nothing;
  get diagnostics v_row_count = row_count;
  v_created := v_row_count = 1;

  select operation.*
  into v_operation
  from public.antonia_quota_operations operation
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = p_resource
    and operation.operation_id = trim(p_operation_id)
  for update;
  if not found then
    raise exception 'quota operation claim was not persisted' using errcode = '55000';
  end if;
  if v_operation.request_fingerprint <> lower(trim(p_request_fingerprint))
    or v_operation.requested_count <> p_requested_count then
    raise exception 'operation id was already used for a different enrichment request' using errcode = '22023';
  end if;

  if not v_created then
    -- A denial never consumed credit, so it is safe to evaluate it again. This
    -- also picks up a UTC reset or a lower override changed by an administrator.
    if v_operation.status = 'failed'
      and not v_operation.quota_allowed
      and v_operation.response_status = 429 then
      v_claim_token := gen_random_uuid();
      update public.antonia_quota_operations operation
      set quota_scope = 'user', quota_day = v_day, quota_count_after = 0, quota_limit = 50,
          status = 'claimed', claim_token = v_claim_token, claimed_at = now(), submitted_at = null,
          completed_at = null, response_status = null, response_payload = null, updated_at = now()
      where operation.id = v_operation.id
      returning * into v_operation;
      v_created := true;
      v_reused := true;
    elsif v_operation.status = 'claimed'
      and v_operation.claimed_at < now() - make_interval(secs => p_stale_after_seconds) then
      v_claim_token := gen_random_uuid();
      update public.antonia_quota_operations operation
      set claim_token = v_claim_token, claimed_at = now(), updated_at = now()
      where operation.id = v_operation.id
      returning * into v_operation;
      v_claimed := true;
      v_reused := true;
    else
      v_claim_token := null;
    end if;

    if not v_created then
      return jsonb_build_object(
        'allowed', v_operation.quota_allowed,
        'claimed', v_claimed,
        'reused', true,
        'status', v_operation.status,
        'claim_token', v_claim_token,
        'provider_state', case
          when v_operation.status = 'claimed' then 'not_started'
          when v_operation.status = 'submitted'
            and v_operation.submitted_at < now() - make_interval(secs => p_stale_after_seconds) then 'unknown'
          when v_operation.status = 'submitted' then 'processing'
          when v_operation.status = 'completed' then 'completed'
          else 'failed'
        end,
        'consumed', v_operation.consumed_count,
        'count', v_operation.quota_count_after,
        'limit', v_operation.quota_limit,
        'day_key', v_operation.quota_day,
        'response_status', v_operation.response_status,
        'response_payload', v_operation.response_payload
      );
    end if;
  end if;

  v_quota := public.consume_antonia_user_daily_credits_v1(
    p_user_id, p_resource, p_requested_count
  );
  v_allowed := coalesce((v_quota ->> 'allowed')::boolean, false);
  v_count := coalesce((v_quota ->> 'count')::integer, 0);
  v_limit := coalesce((v_quota ->> 'limit')::integer, 50);

  if not v_allowed then
    update public.antonia_quota_operations operation
    set quota_scope = 'user', quota_allowed = false, quota_count_after = v_count, quota_limit = v_limit,
        consumed_count = 0, status = 'failed', claim_token = null, completed_at = now(),
        response_status = 429,
        response_payload = jsonb_build_object(
          'error', 'DAILY_ENRICHMENT_QUOTA_EXCEEDED', 'resource', p_resource,
          'count', v_count, 'limit', v_limit,
          'retryAt', ((v_day + 1)::timestamp at time zone 'UTC')
        ),
        updated_at = now()
    where operation.id = v_operation.id
    returning * into v_operation;
  else
    update public.antonia_quota_operations operation
    set quota_scope = 'user', quota_allowed = true, quota_count_after = v_count, quota_limit = v_limit,
        consumed_count = p_requested_count, updated_at = now()
    where operation.id = v_operation.id
    returning * into v_operation;
    v_claimed := true;
  end if;

  return jsonb_build_object(
    'allowed', v_operation.quota_allowed,
    'claimed', v_claimed,
    'reused', v_reused,
    'status', v_operation.status,
    'claim_token', case when v_claimed then v_operation.claim_token else null end,
    'provider_state', case when v_claimed then 'not_started' else 'failed' end,
    'consumed', v_operation.consumed_count,
    'count', v_operation.quota_count_after,
    'limit', v_operation.quota_limit,
    'day_key', v_operation.quota_day,
    'response_status', v_operation.response_status,
    'response_payload', v_operation.response_payload
  );
end;
$$;

create or replace function public.force_antonia_quota_operation_user_scope_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.quota_scope := 'user';
  new.quota_limit := least(new.quota_limit, 50);
  return new;
end;
$$;

drop trigger if exists force_antonia_quota_operation_user_scope_v1
  on public.antonia_quota_operations;
create trigger force_antonia_quota_operation_user_scope_v1
  before insert or update of quota_scope, quota_limit
  on public.antonia_quota_operations
  for each row execute function public.force_antonia_quota_operation_user_scope_v1();

create or replace function public.release_antonia_quota_operation_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_resource text,
  p_operation_id text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_operation public.antonia_quota_operations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.antonia_quota_operations operation
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = p_resource
    and operation.operation_id = trim(p_operation_id)
    and operation.status = 'claimed'
    and operation.claim_token = p_claim_token
  returning * into v_operation;
  if not found then
    return false;
  end if;

  if v_operation.quota_allowed and v_operation.consumed_count > 0 then
    if v_operation.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_operation.user_id,
        v_operation.quota_day,
        v_operation.resource,
        v_operation.consumed_count
      ) then
        raise exception 'shared credit bucket is missing for operation release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_enriched = greatest(0, usage.leads_enriched - case when v_operation.resource = 'enrich' then v_operation.consumed_count else 0 end),
          leads_investigated = greatest(0, usage.leads_investigated - case when v_operation.resource = 'investigate' then v_operation.consumed_count else 0 end),
          updated_at = now()
      where usage.organization_id = v_operation.organization_id and usage.date = v_operation.quota_day;
      if not found then
        raise exception 'organization quota bucket is missing for operation release' using errcode = '55000';
      end if;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.consume_lead_research_request_quota_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
  v_day date := timezone('utc', now())::date;
  v_quota jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_job_id is null or p_user_id is null or p_claim_token is null or p_organization_id is null
    or p_limit is null or p_limit < 0 then
    raise exception 'invalid lead research quota input' using errcode = '22023';
  end if;

  select job.*
  into v_job
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id = p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state = 'pre_provider'
    and job.request_claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'lead research request claim is missing or no longer owned' using errcode = '55000';
  end if;
  if v_job.quota_consumed_at is not null then
    return jsonb_build_object('allowed', true, 'count', 0, 'limit', 50, 'reused', true);
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_user_id
  ) then
    raise exception 'quota user does not belong to organization' using errcode = '22023';
  end if;

  v_quota := public.consume_antonia_user_daily_credits_v1(p_user_id, 'investigate', 1);
  if not coalesce((v_quota ->> 'allowed')::boolean, false) then
    return v_quota || jsonb_build_object('reused', false);
  end if;

  update public.lead_research_jobs
  set quota_consumed_at = now(), quota_day = v_day, quota_scope = 'user', updated_at = now()
  where id = p_job_id;
  return v_quota || jsonb_build_object('reused', false);
end;
$$;

create or replace function public.release_lead_research_request_claim_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select job.* into v_job
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id is not distinct from p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state in ('pre_provider', 'provider_submitting')
    and job.request_claim_token = p_claim_token
  for update;
  if not found then
    return false;
  end if;

  if v_job.request_claim_state = 'pre_provider' and v_job.quota_consumed_at is not null then
    if v_job.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_job.user_id, v_job.quota_day, 'investigate', 1
      ) then
        raise exception 'shared credit bucket is missing for research release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_investigated = usage.leads_investigated - 1, updated_at = now()
      where usage.organization_id = v_job.organization_id
        and usage.date = v_job.quota_day
        and usage.leads_investigated > 0;
      if not found then
        raise exception 'organization quota bucket is missing for research release' using errcode = '55000';
      end if;
    end if;
  end if;

  update public.lead_research_jobs
  set request_claim_state = 'retryable',
      request_claim_token = null,
      request_claimed_at = null,
      quota_consumed_at = case when v_job.request_claim_state = 'pre_provider' then null else quota_consumed_at end,
      quota_day = case when v_job.request_claim_state = 'pre_provider' then null else quota_day end,
      quota_scope = case when v_job.request_claim_state = 'pre_provider' then null else quota_scope end,
      status = 'queued',
      error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      result_payload = null,
      started_at = null,
      completed_at = null,
      updated_at = now()
  where id = v_job.id;
  return true;
end;
$$;

create or replace function public.settle_apollo_enrichment_quota_if_ready_v1(
  p_callback_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_operation public.antonia_quota_operations%rowtype;
  v_remaining_callbacks integer;
  v_submitted_count integer := 0;
  v_refund_count integer := 0;
  v_reveal_phone boolean := false;
  v_updated_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id;
  if not found then
    return false;
  end if;

  select operation.* into v_operation
  from public.antonia_quota_operations operation
  where operation.organization_id = v_callback.organization_id
    and operation.user_id = v_callback.user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_callback.operation_id
    and operation.status = 'submitted'
  for update;
  if not found or v_operation.claim_token is null then
    return false;
  end if;

  select count(*) into v_remaining_callbacks
  from public.apollo_enrichment_callbacks callback
  where callback.organization_id = v_callback.organization_id
    and callback.user_id = v_callback.user_id
    and callback.quota_resource = v_callback.quota_resource
    and callback.operation_id = v_callback.operation_id
    and callback.status <> 'terminal';
  if v_remaining_callbacks > 0 then
    return false;
  end if;

  select count(*) filter (where callback.provider_queued_at is not null),
         coalesce(bool_or(callback.reveal_phone), false)
  into v_submitted_count, v_reveal_phone
  from public.apollo_enrichment_callbacks callback
  where callback.organization_id = v_callback.organization_id
    and callback.user_id = v_callback.user_id
    and callback.quota_resource = v_callback.quota_resource
    and callback.operation_id = v_callback.operation_id;

  v_refund_count := v_operation.consumed_count - v_submitted_count;
  if v_refund_count < 0 then
    raise exception 'Apollo callback count exceeds consumed quota' using errcode = '55000';
  end if;
  if v_refund_count > 0 then
    if v_operation.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_operation.user_id,
        v_operation.quota_day,
        v_operation.resource,
        v_refund_count
      ) then
        raise exception 'shared credit bucket is missing during partial refund' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_enriched = usage.leads_enriched
            - case when v_operation.resource = 'enrich' then v_refund_count else 0 end,
          leads_investigated = usage.leads_investigated
            - case when v_operation.resource = 'investigate' then v_refund_count else 0 end,
          updated_at = now()
      where usage.organization_id = v_operation.organization_id
        and usage.date = v_operation.quota_day
        and usage.leads_enriched >= case when v_operation.resource = 'enrich' then v_refund_count else 0 end
        and usage.leads_investigated >= case when v_operation.resource = 'investigate' then v_refund_count else 0 end;
      get diagnostics v_updated_count = row_count;
      if v_updated_count <> 1 then
        raise exception 'organization quota bucket is missing during partial refund' using errcode = '55000';
      end if;
    end if;

    update public.antonia_quota_operations operation
    set consumed_count = v_submitted_count,
        quota_count_after = greatest(0, operation.quota_count_after - v_refund_count),
        updated_at = now()
    where operation.organization_id = v_operation.organization_id
      and operation.user_id = v_operation.user_id
      and operation.resource = v_operation.resource
      and operation.operation_id = v_operation.operation_id
      and operation.status = 'submitted'
      and operation.claim_token = v_operation.claim_token;
    if not found then
      raise exception 'Apollo quota operation changed during partial refund' using errcode = '55000';
    end if;
  end if;

  return public.complete_antonia_quota_operation_v1(
    v_callback.organization_id,
    v_callback.user_id,
    v_callback.quota_resource,
    v_callback.operation_id,
    v_operation.claim_token,
    'completed',
    case when v_reveal_phone then 202 else 200 end,
    jsonb_build_object(
      'queued', v_reveal_phone,
      'provider', 'apollo',
      'operationId', v_callback.operation_id,
      'operationStatus', 'completed'
    )
  );
end;
$$;

create or replace function public.cancel_native_lead_research_request_claim_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
  v_email text;
  v_reversed_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select lower(trim(coalesce(job.email, ''))) into v_email
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id is not distinct from p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
    and job.request_claim_token = p_claim_token;
  if not found then
    return false;
  end if;
  if v_email = '' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  select * into v_job
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id is not distinct from p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
    and job.request_claim_token = p_claim_token
    and lower(trim(coalesce(job.email, ''))) = v_email
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.unsubscribed_emails email
    where lower(trim(coalesce(email.email, ''))) = v_email
      and (
        (email.user_id is null and email.organization_id is null)
        or email.user_id = p_user_id
        or email.organization_id = p_organization_id
      )
  ) then
    return false;
  end if;

  if v_job.request_claim_state = 'pre_provider' and v_job.quota_consumed_at is not null then
    if v_job.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        p_user_id, v_job.quota_day, 'investigate', 1
      ) then
        raise exception 'shared credit bucket is missing for suppressed research release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_investigated = usage.leads_investigated - 1, updated_at = now()
      where usage.organization_id = p_organization_id
        and usage.date = v_job.quota_day
        and usage.leads_investigated > 0;
      get diagnostics v_reversed_count = row_count;
      if v_reversed_count <> 1 then
        raise exception 'organization quota bucket is missing for suppressed research release' using errcode = '55000';
      end if;
    end if;
  end if;

  update public.lead_research_jobs
  set request_claim_state = 'provider_failed',
      request_claim_token = null,
      request_claimed_at = null,
      quota_consumed_at = case when v_job.request_claim_state = 'pre_provider' then null else quota_consumed_at end,
      quota_day = case when v_job.request_claim_state = 'pre_provider' then null else quota_day end,
      quota_scope = case when v_job.request_claim_state = 'pre_provider' then null else quota_scope end,
      status = 'failed',
      error_code = 'privacy_suppressed',
      error_message = 'Research was cancelled because the recipient is suppressed.',
      result_payload = jsonb_build_object(
        'provider_status', 'failed',
        'error', 'privacy_suppressed'
      ),
      attempt_count = greatest(coalesce(attempt_count, 0), 1),
      started_at = coalesce(started_at, now()),
      completed_at = now(),
      updated_at = now()
  where id = v_job.id;
  return true;
end;
$$;

revoke all on function public.consume_antonia_user_daily_credits_v1(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_antonia_user_daily_credits_v1(uuid, date, text, integer)
  from public, anon, authenticated;
revoke all on function public.consume_suplia_research_tool_credit_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.force_antonia_quota_operation_user_scope_v1()
  from public, anon, authenticated;

grant execute on function public.consume_antonia_user_daily_credits_v1(uuid, text, integer)
  to service_role;
grant execute on function public.release_antonia_user_daily_credits_v1(uuid, date, text, integer)
  to service_role;
grant execute on function public.consume_suplia_research_tool_credit_v1(uuid, uuid, uuid)
  to service_role;

revoke all on function public.consume_antonia_daily_quota_v1(uuid, uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_antonia_quota_operation_v1(uuid, uuid, text, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_antonia_quota_operation_v1(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_lead_research_request_quota_v1(uuid, text, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.settle_apollo_enrichment_quota_if_ready_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.consume_antonia_daily_quota_v1(uuid, uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.claim_antonia_quota_operation_v1(uuid, uuid, text, text, text, text, integer, integer, integer)
  to service_role;
grant execute on function public.release_antonia_quota_operation_v1(uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.consume_lead_research_request_quota_v1(uuid, text, uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.release_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.settle_apollo_enrichment_quota_if_ready_v1(uuid)
  to service_role;
grant execute on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
