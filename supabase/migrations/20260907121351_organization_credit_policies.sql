-- Versioned organization credit policies with user, team, and hybrid enforcement.
-- Existing organizations remain on the legacy account bucket until the next UTC day.

create table public.antonia_credit_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null,
  user_id uuid references auth.users(id) on delete cascade,
  reporting_group_id uuid references public.organization_reporting_groups(id) on delete cascade,
  mode text,
  user_daily_limit integer,
  team_daily_limit integer,
  effective_from date not null,
  effective_to date,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint antonia_credit_policies_subject_check check (
    (subject_type = 'organization' and user_id is null and reporting_group_id is null
      and mode in ('user', 'team', 'hybrid')
      and user_daily_limit is not null and team_daily_limit is not null)
    or (subject_type = 'user' and user_id is not null and reporting_group_id is null
      and mode in ('user', 'team', 'hybrid')
      and user_daily_limit is not null and team_daily_limit is null)
    or (subject_type = 'team' and user_id is null and reporting_group_id is not null
      and mode is null and user_daily_limit is null and team_daily_limit is not null)
  ),
  constraint antonia_credit_policies_user_limit_check check (
    user_daily_limit is null or user_daily_limit between 0 and 1000000
  ),
  constraint antonia_credit_policies_team_limit_check check (
    team_daily_limit is null or team_daily_limit between 0 and 1000000
  ),
  constraint antonia_credit_policies_effective_range_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint antonia_credit_policies_reason_check check (
    reason is null or length(trim(reason)) between 1 and 500
  )
);

create index antonia_credit_policies_organization_effective_idx
  on public.antonia_credit_policies (organization_id, subject_type, effective_from desc, created_at desc)
  where cancelled_at is null;
create index antonia_credit_policies_user_effective_idx
  on public.antonia_credit_policies (organization_id, user_id, effective_from desc)
  where subject_type = 'user' and cancelled_at is null;
create index antonia_credit_policies_team_effective_idx
  on public.antonia_credit_policies (organization_id, reporting_group_id, effective_from desc)
  where subject_type = 'team' and cancelled_at is null;

create table public.antonia_credit_team_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reporting_group_id uuid not null references public.organization_reporting_groups(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint antonia_credit_team_assignments_effective_range_check check (
    effective_to is null or effective_to >= effective_from
  )
);

create index antonia_credit_team_assignments_user_effective_idx
  on public.antonia_credit_team_assignments (organization_id, user_id, effective_from desc, created_at desc)
  where cancelled_at is null;

create table public.antonia_daily_credit_buckets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bucket_type text not null check (bucket_type in ('user', 'team')),
  user_id uuid references auth.users(id) on delete cascade,
  reporting_group_id uuid references public.organization_reporting_groups(id) on delete cascade,
  quota_day date not null,
  limit_snapshot integer not null check (limit_snapshot between 0 and 1000000),
  usage_count integer not null default 0,
  search_count integer not null default 0,
  enrich_count integer not null default 0,
  investigate_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint antonia_daily_credit_buckets_subject_check check (
    (bucket_type = 'user' and user_id is not null and reporting_group_id is null)
    or (bucket_type = 'team' and user_id is null and reporting_group_id is not null)
  ),
  constraint antonia_daily_credit_buckets_counts_check check (
    usage_count >= 0 and search_count >= 0 and enrich_count >= 0 and investigate_count >= 0
    and usage_count = search_count + enrich_count + investigate_count
  )
);

create unique index antonia_daily_credit_buckets_user_uidx
  on public.antonia_daily_credit_buckets (organization_id, user_id, quota_day)
  where bucket_type = 'user';
create unique index antonia_daily_credit_buckets_team_uidx
  on public.antonia_daily_credit_buckets (organization_id, reporting_group_id, quota_day)
  where bucket_type = 'team';
create index antonia_daily_credit_buckets_day_idx
  on public.antonia_daily_credit_buckets (organization_id, quota_day desc);

alter table public.antonia_credit_policies enable row level security;
alter table public.antonia_credit_team_assignments enable row level security;
alter table public.antonia_daily_credit_buckets enable row level security;
revoke all on table public.antonia_credit_policies from public, anon, authenticated;
revoke all on table public.antonia_credit_team_assignments from public, anon, authenticated;
revoke all on table public.antonia_daily_credit_buckets from public, anon, authenticated;
grant select, insert, update on table public.antonia_credit_policies to service_role;
grant select, insert, update on table public.antonia_credit_team_assignments to service_role;
grant select, insert, update on table public.antonia_daily_credit_buckets to service_role;

alter table public.antonia_quota_operations
  add column if not exists credit_mode text,
  add column if not exists credit_group_id uuid references public.organization_reporting_groups(id) on delete set null,
  add column if not exists credit_user_policy_id uuid references public.antonia_credit_policies(id) on delete set null,
  add column if not exists credit_team_policy_id uuid references public.antonia_credit_policies(id) on delete set null;

alter table public.lead_research_jobs
  add column if not exists credit_mode text,
  add column if not exists credit_group_id uuid references public.organization_reporting_groups(id) on delete set null,
  add column if not exists credit_user_policy_id uuid references public.antonia_credit_policies(id) on delete set null,
  add column if not exists credit_team_policy_id uuid references public.antonia_credit_policies(id) on delete set null;

alter table public.antonia_suplia_research_credit_operations
  add column if not exists credit_mode text,
  add column if not exists credit_group_id uuid references public.organization_reporting_groups(id) on delete set null,
  add column if not exists credit_user_policy_id uuid references public.antonia_credit_policies(id) on delete set null,
  add column if not exists credit_team_policy_id uuid references public.antonia_credit_policies(id) on delete set null;

alter table public.antonia_quota_operations
  drop constraint if exists antonia_quota_operations_credit_mode_check;
alter table public.antonia_quota_operations
  add constraint antonia_quota_operations_credit_mode_check
    check (credit_mode is null or credit_mode in ('user', 'team', 'hybrid'));
alter table public.lead_research_jobs
  drop constraint if exists lead_research_jobs_credit_mode_check;
alter table public.lead_research_jobs
  add constraint lead_research_jobs_credit_mode_check
    check (credit_mode is null or credit_mode in ('user', 'team', 'hybrid'));
alter table public.antonia_suplia_research_credit_operations
  drop constraint if exists antonia_suplia_credit_mode_check;
alter table public.antonia_suplia_research_credit_operations
  add constraint antonia_suplia_credit_mode_check
    check (credit_mode is null or credit_mode in ('user', 'team', 'hybrid'));

drop trigger if exists force_antonia_quota_operation_user_scope_v1
  on public.antonia_quota_operations;

create or replace function public.resolve_antonia_credit_context_v2(
  p_organization_id uuid,
  p_user_id uuid,
  p_day date default timezone('utc', now())::date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_organization_policy public.antonia_credit_policies%rowtype;
  v_user_policy public.antonia_credit_policies%rowtype;
  v_team_policy public.antonia_credit_policies%rowtype;
  v_group_id uuid;
  v_mode text;
  v_user_limit integer;
  v_team_limit integer;
  v_legacy_limit integer := 50;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null or p_day is null then
    raise exception 'invalid credit context input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_user_id
  ) then
    raise exception 'credit user does not belong to organization' using errcode = '22023';
  end if;

  select policy.* into v_organization_policy
  from public.antonia_credit_policies policy
  where policy.organization_id = p_organization_id
    and policy.subject_type = 'organization'
    and policy.cancelled_at is null
    and policy.effective_from <= p_day
    and (policy.effective_to is null or policy.effective_to >= p_day)
  order by policy.effective_from desc, policy.created_at desc
  limit 1;

  select policy.* into v_user_policy
  from public.antonia_credit_policies policy
  where policy.organization_id = p_organization_id
    and policy.subject_type = 'user'
    and policy.user_id = p_user_id
    and policy.cancelled_at is null
    and policy.effective_from <= p_day
    and (policy.effective_to is null or policy.effective_to >= p_day)
  order by policy.effective_from desc, policy.created_at desc
  limit 1;

  if v_organization_policy.id is null and v_user_policy.id is null then
    select least(50, coalesce(nullif(override.daily_credit_limit, 0), 50))
    into v_legacy_limit
    from public.user_quota_overrides override
    where override.user_id = p_user_id;
    return jsonb_build_object(
      'legacy', true,
      'mode', 'user',
      'user_limit', coalesce(v_legacy_limit, 50),
      'team_limit', null,
      'group_id', null,
      'user_policy_id', null,
      'team_policy_id', null
    );
  end if;

  v_mode := coalesce(v_user_policy.mode, v_organization_policy.mode, 'user');
  v_user_limit := coalesce(v_user_policy.user_daily_limit, v_organization_policy.user_daily_limit, 50);

  if v_mode in ('team', 'hybrid') then
    select assignment.reporting_group_id into v_group_id
    from public.antonia_credit_team_assignments assignment
    join public.organization_reporting_groups reporting_group
      on reporting_group.id = assignment.reporting_group_id
      and reporting_group.organization_id = assignment.organization_id
      and reporting_group.is_active
    where assignment.organization_id = p_organization_id
      and assignment.user_id = p_user_id
      and assignment.cancelled_at is null
      and assignment.effective_from <= p_day
      and (assignment.effective_to is null or assignment.effective_to >= p_day)
    order by assignment.effective_from desc, assignment.created_at desc
    limit 1;
    if v_group_id is null then
      raise exception 'PRIMARY_CREDIT_TEAM_REQUIRED' using errcode = '22023';
    end if;

    select policy.* into v_team_policy
    from public.antonia_credit_policies policy
    where policy.organization_id = p_organization_id
      and policy.subject_type = 'team'
      and policy.reporting_group_id = v_group_id
      and policy.cancelled_at is null
      and policy.effective_from <= p_day
      and (policy.effective_to is null or policy.effective_to >= p_day)
    order by policy.effective_from desc, policy.created_at desc
    limit 1;
    v_team_limit := coalesce(v_team_policy.team_daily_limit, v_organization_policy.team_daily_limit, 50);
  end if;

  return jsonb_build_object(
    'legacy', false,
    'mode', v_mode,
    'user_limit', v_user_limit,
    'team_limit', v_team_limit,
    'group_id', v_group_id,
    'user_policy_id', coalesce(v_user_policy.id, v_organization_policy.id),
    'team_policy_id', coalesce(v_team_policy.id, v_organization_policy.id)
  );
end;
$$;

create or replace function public.consume_antonia_organization_credits_v2(
  p_organization_id uuid,
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
  v_context jsonb;
  v_mode text;
  v_group_id uuid;
  v_user_bucket public.antonia_daily_credit_buckets%rowtype;
  v_team_bucket public.antonia_daily_credit_buckets%rowtype;
  v_binding text;
  v_allowed boolean := true;
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null
    or v_resource not in ('search', 'enrich', 'investigate')
    or p_requested_count is null or p_requested_count <= 0 then
    raise exception 'invalid organization credit input' using errcode = '22023';
  end if;

  v_context := public.resolve_antonia_credit_context_v2(p_organization_id, p_user_id, v_day);
  if coalesce((v_context ->> 'legacy')::boolean, false) then
    return public.consume_antonia_user_daily_credits_v1(p_user_id, v_resource, p_requested_count)
      || v_context || jsonb_build_object('binding', 'user');
  end if;

  v_mode := v_context ->> 'mode';
  v_group_id := nullif(v_context ->> 'group_id', '')::uuid;

  if v_mode in ('user', 'hybrid') then
    insert into public.antonia_daily_credit_buckets (
      organization_id, bucket_type, user_id, quota_day, limit_snapshot
    ) values (
      p_organization_id, 'user', p_user_id, v_day, (v_context ->> 'user_limit')::integer
    ) on conflict (organization_id, user_id, quota_day) where bucket_type = 'user' do nothing;

    select bucket.* into v_user_bucket
    from public.antonia_daily_credit_buckets bucket
    where bucket.organization_id = p_organization_id
      and bucket.bucket_type = 'user'
      and bucket.user_id = p_user_id
      and bucket.quota_day = v_day
    for update;
    if not found then
      raise exception 'user credit bucket is missing' using errcode = '55000';
    end if;
    v_allowed := v_user_bucket.usage_count <= v_user_bucket.limit_snapshot - p_requested_count;
  end if;

  if v_mode in ('team', 'hybrid') then
    insert into public.antonia_daily_credit_buckets (
      organization_id, bucket_type, reporting_group_id, quota_day, limit_snapshot
    ) values (
      p_organization_id, 'team', v_group_id, v_day, (v_context ->> 'team_limit')::integer
    ) on conflict (organization_id, reporting_group_id, quota_day) where bucket_type = 'team' do nothing;

    select bucket.* into v_team_bucket
    from public.antonia_daily_credit_buckets bucket
    where bucket.organization_id = p_organization_id
      and bucket.bucket_type = 'team'
      and bucket.reporting_group_id = v_group_id
      and bucket.quota_day = v_day
    for update;
    if not found then
      raise exception 'team credit bucket is missing' using errcode = '55000';
    end if;
    v_allowed := v_allowed
      and v_team_bucket.usage_count <= v_team_bucket.limit_snapshot - p_requested_count;
  end if;

  if v_mode = 'user' then
    v_binding := 'user';
  elsif v_mode = 'team' then
    v_binding := 'team';
  elsif v_user_bucket.limit_snapshot - v_user_bucket.usage_count
      <= v_team_bucket.limit_snapshot - v_team_bucket.usage_count then
    v_binding := 'user';
  else
    v_binding := 'team';
  end if;

  if v_allowed and v_mode in ('user', 'hybrid') then
    update public.antonia_daily_credit_buckets bucket
    set usage_count = bucket.usage_count + p_requested_count,
        search_count = bucket.search_count + case when v_resource = 'search' then p_requested_count else 0 end,
        enrich_count = bucket.enrich_count + case when v_resource = 'enrich' then p_requested_count else 0 end,
        investigate_count = bucket.investigate_count + case when v_resource = 'investigate' then p_requested_count else 0 end,
        updated_at = now()
    where bucket.id = v_user_bucket.id
    returning * into v_user_bucket;
  end if;
  if v_allowed and v_mode in ('team', 'hybrid') then
    update public.antonia_daily_credit_buckets bucket
    set usage_count = bucket.usage_count + p_requested_count,
        search_count = bucket.search_count + case when v_resource = 'search' then p_requested_count else 0 end,
        enrich_count = bucket.enrich_count + case when v_resource = 'enrich' then p_requested_count else 0 end,
        investigate_count = bucket.investigate_count + case when v_resource = 'investigate' then p_requested_count else 0 end,
        updated_at = now()
    where bucket.id = v_team_bucket.id
    returning * into v_team_bucket;
  end if;

  v_result := jsonb_build_object(
    'allowed', v_allowed,
    'count', case when v_binding = 'user' then v_user_bucket.usage_count else v_team_bucket.usage_count end,
    'limit', case when v_binding = 'user' then v_user_bucket.limit_snapshot else v_team_bucket.limit_snapshot end,
    'day_key', v_day,
    'binding', v_binding,
    'user_count', case when v_mode in ('user', 'hybrid') then v_user_bucket.usage_count else null end,
    'user_limit', case when v_mode in ('user', 'hybrid') then v_user_bucket.limit_snapshot else null end,
    'team_count', case when v_mode in ('team', 'hybrid') then v_team_bucket.usage_count else null end,
    'team_limit', case when v_mode in ('team', 'hybrid') then v_team_bucket.limit_snapshot else null end
  );
  return v_result || v_context;
end;
$$;

create or replace function public.release_antonia_organization_credits_v2(
  p_organization_id uuid,
  p_user_id uuid,
  p_day date,
  p_resource text,
  p_released_count integer,
  p_mode text,
  p_group_id uuid
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
  v_user_bucket public.antonia_daily_credit_buckets%rowtype;
  v_team_bucket public.antonia_daily_credit_buckets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null or p_day is null
    or v_resource not in ('search', 'enrich', 'investigate')
    or p_released_count is null or p_released_count <= 0
    or p_mode not in ('user', 'team', 'hybrid')
    or (p_mode in ('team', 'hybrid') and p_group_id is null) then
    raise exception 'invalid organization credit release input' using errcode = '22023';
  end if;

  if p_mode in ('user', 'hybrid') then
    select bucket.* into v_user_bucket
    from public.antonia_daily_credit_buckets bucket
    where bucket.organization_id = p_organization_id
      and bucket.bucket_type = 'user'
      and bucket.user_id = p_user_id
      and bucket.quota_day = p_day
    for update;
    if not found or v_user_bucket.usage_count < p_released_count
      or (v_resource = 'search' and v_user_bucket.search_count < p_released_count)
      or (v_resource = 'enrich' and v_user_bucket.enrich_count < p_released_count)
      or (v_resource = 'investigate' and v_user_bucket.investigate_count < p_released_count) then
      return false;
    end if;
  end if;
  if p_mode in ('team', 'hybrid') then
    select bucket.* into v_team_bucket
    from public.antonia_daily_credit_buckets bucket
    where bucket.organization_id = p_organization_id
      and bucket.bucket_type = 'team'
      and bucket.reporting_group_id = p_group_id
      and bucket.quota_day = p_day
    for update;
    if not found or v_team_bucket.usage_count < p_released_count
      or (v_resource = 'search' and v_team_bucket.search_count < p_released_count)
      or (v_resource = 'enrich' and v_team_bucket.enrich_count < p_released_count)
      or (v_resource = 'investigate' and v_team_bucket.investigate_count < p_released_count) then
      return false;
    end if;
  end if;

  if p_mode in ('user', 'hybrid') then
    update public.antonia_daily_credit_buckets bucket
    set usage_count = bucket.usage_count - p_released_count,
        search_count = bucket.search_count - case when v_resource = 'search' then p_released_count else 0 end,
        enrich_count = bucket.enrich_count - case when v_resource = 'enrich' then p_released_count else 0 end,
        investigate_count = bucket.investigate_count - case when v_resource = 'investigate' then p_released_count else 0 end,
        updated_at = now()
    where bucket.id = v_user_bucket.id;
  end if;
  if p_mode in ('team', 'hybrid') then
    update public.antonia_daily_credit_buckets bucket
    set usage_count = bucket.usage_count - p_released_count,
        search_count = bucket.search_count - case when v_resource = 'search' then p_released_count else 0 end,
        enrich_count = bucket.enrich_count - case when v_resource = 'enrich' then p_released_count else 0 end,
        investigate_count = bucket.investigate_count - case when v_resource = 'investigate' then p_released_count else 0 end,
        updated_at = now()
    where bucket.id = v_team_bucket.id;
  end if;
  return true;
end;
$$;

create or replace function public.get_antonia_credit_status_v2(
  p_organization_id uuid,
  p_user_id uuid,
  p_day date default timezone('utc', now())::date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_context jsonb;
  v_mode text;
  v_group_id uuid;
  v_user_count integer := 0;
  v_team_count integer := 0;
  v_user_limit integer;
  v_team_limit integer;
  v_bucket_limit integer;
  v_binding text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_context := public.resolve_antonia_credit_context_v2(p_organization_id, p_user_id, p_day);
  if coalesce((v_context ->> 'legacy')::boolean, false) then
    select coalesce(credits.usage_count, 0) into v_user_count
    from public.antonia_user_daily_credits credits
    where credits.user_id = p_user_id and credits.date = p_day;
    v_user_count := coalesce(v_user_count, 0);
    return v_context || jsonb_build_object(
      'allowed', v_user_count < (v_context ->> 'user_limit')::integer,
      'count', v_user_count,
      'limit', (v_context ->> 'user_limit')::integer,
      'day_key', p_day,
      'binding', 'user',
      'user_count', v_user_count,
      'team_count', null
    );
  end if;

  v_mode := v_context ->> 'mode';
  v_group_id := nullif(v_context ->> 'group_id', '')::uuid;
  v_user_limit := nullif(v_context ->> 'user_limit', '')::integer;
  v_team_limit := nullif(v_context ->> 'team_limit', '')::integer;

  if v_mode in ('user', 'hybrid') then
    select bucket.usage_count, bucket.limit_snapshot
    into v_user_count, v_bucket_limit
    from public.antonia_daily_credit_buckets bucket
    where bucket.organization_id = p_organization_id
      and bucket.bucket_type = 'user'
      and bucket.user_id = p_user_id
      and bucket.quota_day = p_day;
    if found then v_user_limit := v_bucket_limit; end if;
    v_user_count := coalesce(v_user_count, 0);
  end if;
  if v_mode in ('team', 'hybrid') then
    select bucket.usage_count, bucket.limit_snapshot
    into v_team_count, v_bucket_limit
    from public.antonia_daily_credit_buckets bucket
    where bucket.organization_id = p_organization_id
      and bucket.bucket_type = 'team'
      and bucket.reporting_group_id = v_group_id
      and bucket.quota_day = p_day;
    if found then v_team_limit := v_bucket_limit; end if;
    v_team_count := coalesce(v_team_count, 0);
  end if;

  if v_mode = 'user' then
    v_binding := 'user';
  elsif v_mode = 'team' then
    v_binding := 'team';
  elsif v_user_limit - v_user_count <= v_team_limit - v_team_count then
    v_binding := 'user';
  else
    v_binding := 'team';
  end if;

  return v_context || jsonb_build_object(
    'allowed', case
      when v_mode = 'user' then v_user_count < v_user_limit
      when v_mode = 'team' then v_team_count < v_team_limit
      else v_user_count < v_user_limit and v_team_count < v_team_limit
    end,
    'count', case when v_binding = 'user' then v_user_count else v_team_count end,
    'limit', case when v_binding = 'user' then v_user_limit else v_team_limit end,
    'day_key', p_day,
    'binding', v_binding,
    'user_count', case when v_mode in ('user', 'hybrid') then v_user_count else null end,
    'user_limit', case when v_mode in ('user', 'hybrid') then v_user_limit else null end,
    'team_count', case when v_mode in ('team', 'hybrid') then v_team_count else null end,
    'team_limit', case when v_mode in ('team', 'hybrid') then v_team_limit else null end
  );
end;
$$;

create or replace function public.schedule_antonia_credit_policy_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_mode text,
  p_user_daily_limit integer,
  p_team_daily_limit integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_effective_from date := timezone('utc', now())::date + 1;
  v_user_id uuid;
  v_group_id uuid;
  v_primary_group_id uuid;
  v_member record;
  v_policy public.antonia_credit_policies%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_actor_user_id is null
    or p_subject_type not in ('organization', 'user', 'team') then
    raise exception 'invalid credit policy input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner', 'admin')
  ) then
    raise exception 'credit policy actor is not an organization admin' using errcode = '42501';
  end if;

  if p_subject_type = 'organization' then
    if p_subject_id is distinct from p_organization_id
      or p_mode not in ('user', 'team', 'hybrid')
      or p_user_daily_limit is null
      or p_user_daily_limit not between 0 and 1000000
      or p_team_daily_limit is null
      or p_team_daily_limit not between 0 and 1000000 then
      raise exception 'invalid organization credit policy' using errcode = '22023';
    end if;
    if p_mode in ('team', 'hybrid') then
      if exists (
        select 1 from public.organization_members member
        where member.organization_id = p_organization_id
          and not exists (
            select 1 from public.organization_reporting_group_members membership
            join public.organization_reporting_groups reporting_group
              on reporting_group.id = membership.group_id
              and reporting_group.organization_id = membership.organization_id
              and reporting_group.is_active
            where membership.organization_id = p_organization_id
              and membership.user_id = member.user_id
              and membership.is_primary
              and membership.unassigned_at is null
          )
      ) then
        raise exception 'all credit users require a primary reporting team' using errcode = '22023';
      end if;
      for v_member in
        select membership.user_id, membership.group_id
        from public.organization_reporting_group_members membership
        join public.organization_reporting_groups reporting_group
          on reporting_group.id = membership.group_id
          and reporting_group.organization_id = membership.organization_id
          and reporting_group.is_active
        where membership.organization_id = p_organization_id
          and membership.is_primary
          and membership.unassigned_at is null
      loop
        perform public.schedule_antonia_credit_team_assignment_v1(
          p_organization_id, p_actor_user_id, v_member.user_id, v_member.group_id
        );
      end loop;
    end if;
  elsif p_subject_type = 'user' then
    if p_subject_id is null or p_mode not in ('user', 'team', 'hybrid')
      or p_user_daily_limit is null
      or p_user_daily_limit not between 0 and 1000000
      or p_team_daily_limit is not null
      or not exists (
        select 1 from public.organization_members member
        where member.organization_id = p_organization_id and member.user_id = p_subject_id
      ) then
      raise exception 'invalid user credit policy' using errcode = '22023';
    end if;
    v_user_id := p_subject_id;
    if p_mode in ('team', 'hybrid') then
      select membership.group_id into v_primary_group_id
      from public.organization_reporting_group_members membership
      join public.organization_reporting_groups reporting_group
        on reporting_group.id = membership.group_id
        and reporting_group.organization_id = membership.organization_id
        and reporting_group.is_active
      where membership.organization_id = p_organization_id
        and membership.user_id = p_subject_id
        and membership.is_primary
        and membership.unassigned_at is null
      limit 1;
      if v_primary_group_id is null then
        raise exception 'credit user requires a primary reporting team' using errcode = '22023';
      end if;
      perform public.schedule_antonia_credit_team_assignment_v1(
        p_organization_id, p_actor_user_id, p_subject_id, v_primary_group_id
      );
    end if;
  else
    if p_subject_id is null or p_mode is not null or p_user_daily_limit is not null
      or p_team_daily_limit is null
      or p_team_daily_limit not between 0 and 1000000
      or not exists (
        select 1 from public.organization_reporting_groups reporting_group
        where reporting_group.organization_id = p_organization_id
          and reporting_group.id = p_subject_id
          and reporting_group.is_active
      ) then
      raise exception 'invalid team credit policy' using errcode = '22023';
    end if;
    v_group_id := p_subject_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat('antonia-credit-policy:', p_organization_id, ':', p_subject_type, ':', p_subject_id), 0
  ));

  update public.antonia_credit_policies policy
  set cancelled_at = now()
  where policy.organization_id = p_organization_id
    and policy.subject_type = p_subject_type
    and policy.user_id is not distinct from v_user_id
    and policy.reporting_group_id is not distinct from v_group_id
    and policy.effective_from >= v_effective_from
    and policy.cancelled_at is null;

  update public.antonia_credit_policies policy
  set effective_to = v_effective_from - 1
  where policy.organization_id = p_organization_id
    and policy.subject_type = p_subject_type
    and policy.user_id is not distinct from v_user_id
    and policy.reporting_group_id is not distinct from v_group_id
    and policy.effective_from < v_effective_from
    and policy.cancelled_at is null
    and (policy.effective_to is null or policy.effective_to >= v_effective_from);

  insert into public.antonia_credit_policies (
    organization_id, subject_type, user_id, reporting_group_id, mode,
    user_daily_limit, team_daily_limit, effective_from, created_by, reason
  ) values (
    p_organization_id, p_subject_type, v_user_id, v_group_id, p_mode,
    p_user_daily_limit, p_team_daily_limit, v_effective_from, p_actor_user_id,
    nullif(trim(coalesce(p_reason, '')), '')
  ) returning * into v_policy;
  return to_jsonb(v_policy);
end;
$$;

create or replace function public.clear_antonia_credit_policy_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_subject_type text,
  p_subject_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_effective_from date := timezone('utc', now())::date + 1;
  v_user_id uuid;
  v_group_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_subject_type not in ('user', 'team') then
    raise exception 'only user or team policies can inherit defaults' using errcode = '22023';
  end if;
  if p_organization_id is null or p_actor_user_id is null or p_subject_id is null then
    raise exception 'invalid credit policy inheritance input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
      and member.role in ('owner', 'admin')
  ) then
    raise exception 'credit policy actor is not an organization admin' using errcode = '42501';
  end if;
  if p_subject_type = 'user' then
    if not exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id and member.user_id = p_subject_id
    ) then
      raise exception 'credit policy user does not belong to organization' using errcode = '22023';
    end if;
    v_user_id := p_subject_id;
  else
    if not exists (
      select 1 from public.organization_reporting_groups reporting_group
      where reporting_group.organization_id = p_organization_id and reporting_group.id = p_subject_id
    ) then
      raise exception 'credit policy team does not belong to organization' using errcode = '22023';
    end if;
    v_group_id := p_subject_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    concat('antonia-credit-policy:', p_organization_id, ':', p_subject_type, ':', p_subject_id), 0
  ));

  update public.antonia_credit_policies policy
  set cancelled_at = now()
  where policy.organization_id = p_organization_id
    and policy.subject_type = p_subject_type
    and policy.user_id is not distinct from v_user_id
    and policy.reporting_group_id is not distinct from v_group_id
    and policy.effective_from >= v_effective_from
    and policy.cancelled_at is null;
  update public.antonia_credit_policies policy
  set effective_to = v_effective_from - 1
  where policy.organization_id = p_organization_id
    and policy.subject_type = p_subject_type
    and policy.user_id is not distinct from v_user_id
    and policy.reporting_group_id is not distinct from v_group_id
    and policy.effective_from < v_effective_from
    and policy.cancelled_at is null
    and (policy.effective_to is null or policy.effective_to >= v_effective_from);
  return true;
end;
$$;

create or replace function public.schedule_antonia_credit_team_assignment_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_user_id uuid,
  p_reporting_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_effective_from date := timezone('utc', now())::date + 1;
  v_assignment public.antonia_credit_team_assignments%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_actor_user_id is null or p_user_id is null
    or not exists (
      select 1 from public.organization_members actor
      where actor.organization_id = p_organization_id
        and actor.user_id = p_actor_user_id
        and actor.role in ('owner', 'admin')
    )
    or not exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id and member.user_id = p_user_id
    )
    or (p_reporting_group_id is not null and not exists (
      select 1 from public.organization_reporting_groups reporting_group
      where reporting_group.organization_id = p_organization_id
        and reporting_group.id = p_reporting_group_id
        and reporting_group.is_active
    )) then
    raise exception 'invalid credit team assignment' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat('antonia-credit-team:', p_organization_id, ':', p_user_id), 0
  ));
  update public.antonia_credit_team_assignments assignment
  set cancelled_at = now()
  where assignment.organization_id = p_organization_id
    and assignment.user_id = p_user_id
    and assignment.effective_from >= v_effective_from
    and assignment.cancelled_at is null;
  update public.antonia_credit_team_assignments assignment
  set effective_to = v_effective_from - 1
  where assignment.organization_id = p_organization_id
    and assignment.user_id = p_user_id
    and assignment.effective_from < v_effective_from
    and assignment.cancelled_at is null
    and (assignment.effective_to is null or assignment.effective_to >= v_effective_from);

  if p_reporting_group_id is null then
    return jsonb_build_object('effective_from', v_effective_from, 'reporting_group_id', null);
  end if;
  insert into public.antonia_credit_team_assignments (
    organization_id, user_id, reporting_group_id, effective_from, created_by
  ) values (
    p_organization_id, p_user_id, p_reporting_group_id, v_effective_from, p_actor_user_id
  ) returning * into v_assignment;
  return to_jsonb(v_assignment);
end;
$$;

create or replace function public.manage_organization_reporting_group_member_v2(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_group_id uuid,
  p_user_id uuid,
  p_action text,
  p_is_primary boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_was_primary boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_action not in ('assign', 'remove')
    or not exists (
      select 1 from public.organization_members actor
      where actor.organization_id = p_organization_id
        and actor.user_id = p_actor_user_id
        and actor.role in ('owner', 'admin')
    )
    or not exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id and member.user_id = p_user_id
    )
    or not exists (
      select 1 from public.organization_reporting_groups reporting_group
      where reporting_group.organization_id = p_organization_id and reporting_group.id = p_group_id
    ) then
    raise exception 'invalid reporting group membership change' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat('reporting-group-member:', p_organization_id, ':', p_user_id), 0
  ));
  select coalesce(membership.is_primary, false) into v_was_primary
  from public.organization_reporting_group_members membership
  where membership.organization_id = p_organization_id
    and membership.group_id = p_group_id
    and membership.user_id = p_user_id
    and membership.unassigned_at is null;
  v_was_primary := coalesce(v_was_primary, false);

  if p_action = 'remove' then
    update public.organization_reporting_group_members membership
    set is_primary = false, unassigned_at = now()
    where membership.organization_id = p_organization_id
      and membership.group_id = p_group_id
      and membership.user_id = p_user_id
      and membership.unassigned_at is null;
    if v_was_primary then
      perform public.schedule_antonia_credit_team_assignment_v1(
        p_organization_id, p_actor_user_id, p_user_id, null
      );
    end if;
    return true;
  end if;

  if p_is_primary then
    update public.organization_reporting_group_members membership
    set is_primary = false
    where membership.organization_id = p_organization_id
      and membership.user_id = p_user_id
      and membership.unassigned_at is null;
  end if;
  insert into public.organization_reporting_group_members (
    organization_id, group_id, user_id, is_primary, assigned_at, unassigned_at
  ) values (
    p_organization_id, p_group_id, p_user_id, p_is_primary, now(), null
  ) on conflict (group_id, user_id) do update
  set organization_id = excluded.organization_id,
      is_primary = excluded.is_primary,
      assigned_at = case
        when public.organization_reporting_group_members.unassigned_at is not null then now()
        else public.organization_reporting_group_members.assigned_at
      end,
      unassigned_at = null;
  if p_is_primary then
    perform public.schedule_antonia_credit_team_assignment_v1(
      p_organization_id, p_actor_user_id, p_user_id, p_group_id
    );
  end if;
  return true;
end;
$$;

-- Start organization-aware accounting at the next reset so today's legacy
-- usage and refunds continue to reconcile against the same buckets.
insert into public.antonia_credit_policies (
  organization_id, subject_type, mode, user_daily_limit, team_daily_limit,
  effective_from, reason
)
select organization.id, 'organization', 'user', 50, 50,
       timezone('utc', now())::date + 1, 'Organization credit policy migration'
from public.organizations organization
where not exists (
  select 1 from public.antonia_credit_policies policy
  where policy.organization_id = organization.id
    and policy.subject_type = 'organization'
    and policy.cancelled_at is null
);

insert into public.antonia_credit_team_assignments (
  organization_id, user_id, reporting_group_id, effective_from
)
select membership.organization_id, membership.user_id, membership.group_id,
       timezone('utc', now())::date + 1
from public.organization_reporting_group_members membership
join public.organization_reporting_groups reporting_group
  on reporting_group.id = membership.group_id
  and reporting_group.organization_id = membership.organization_id
  and reporting_group.is_active
where membership.is_primary
  and membership.unassigned_at is null
  and not exists (
    select 1 from public.antonia_credit_team_assignments assignment
    where assignment.organization_id = membership.organization_id
      and assignment.user_id = membership.user_id
      and assignment.cancelled_at is null
  );

revoke all on function public.resolve_antonia_credit_context_v2(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.consume_antonia_organization_credits_v2(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.release_antonia_organization_credits_v2(uuid, uuid, date, text, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_antonia_credit_status_v2(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.schedule_antonia_credit_policy_v1(uuid, uuid, text, uuid, text, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.clear_antonia_credit_policy_v1(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.schedule_antonia_credit_team_assignment_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.manage_organization_reporting_group_member_v2(uuid, uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_antonia_credit_context_v2(uuid, uuid, date) to service_role;
grant execute on function public.consume_antonia_organization_credits_v2(uuid, uuid, text, integer) to service_role;
grant execute on function public.release_antonia_organization_credits_v2(uuid, uuid, date, text, integer, text, uuid) to service_role;
grant execute on function public.get_antonia_credit_status_v2(uuid, uuid, date) to service_role;
grant execute on function public.schedule_antonia_credit_policy_v1(uuid, uuid, text, uuid, text, integer, integer, text) to service_role;
grant execute on function public.clear_antonia_credit_policy_v1(uuid, uuid, text, uuid) to service_role;
grant execute on function public.schedule_antonia_credit_team_assignment_v1(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.manage_organization_reporting_group_member_v2(uuid, uuid, uuid, uuid, text, boolean) to service_role;

-- Preserve deployed RPC signatures while routing organization-aware calls to
-- the new policy boundary.
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
declare
  v_quota jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null
    or p_scope not in ('organization', 'user')
    or p_resource not in ('leadSearch', 'search', 'enrich', 'investigate', 'research')
    or p_requested_count is null or p_requested_count <= 0
    or p_limit is null or p_limit < 0 then
    raise exception 'invalid daily quota input' using errcode = '22023';
  end if;
  v_quota := public.consume_antonia_organization_credits_v2(
    p_organization_id, p_user_id, p_resource, p_requested_count
  );
  if coalesce((v_quota ->> 'legacy')::boolean, false) then
    return v_quota
      - 'legacy' - 'mode' - 'user_limit' - 'team_limit' - 'group_id'
      - 'user_policy_id' - 'team_policy_id' - 'binding';
  end if;
  return v_quota;
end;
$$;

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
  v_credit_mode text;
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
    p_requested_count, 'user', v_day, 0, 'claimed',
    v_claim_token, now(), now(), now()
  ) on conflict (organization_id, user_id, resource, operation_id) do nothing;
  get diagnostics v_row_count = row_count;
  v_created := v_row_count = 1;

  select operation.* into v_operation
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
    if v_operation.status = 'failed'
      and not v_operation.quota_allowed
      and v_operation.response_status = 429 then
      v_claim_token := gen_random_uuid();
      update public.antonia_quota_operations operation
      set quota_scope = 'user', quota_day = v_day, quota_count_after = 0, quota_limit = 0,
          credit_mode = null, credit_group_id = null,
          credit_user_policy_id = null, credit_team_policy_id = null,
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
        'mode', coalesce(v_operation.credit_mode, 'user'),
        'group_id', v_operation.credit_group_id,
        'response_status', v_operation.response_status,
        'response_payload', v_operation.response_payload
      );
    end if;
  end if;

  v_quota := public.consume_antonia_organization_credits_v2(
    p_organization_id, p_user_id, p_resource, p_requested_count
  );
  v_allowed := coalesce((v_quota ->> 'allowed')::boolean, false);
  v_count := coalesce((v_quota ->> 'count')::integer, 0);
  v_limit := coalesce((v_quota ->> 'limit')::integer, 0);
  v_credit_mode := case
    when coalesce((v_quota ->> 'legacy')::boolean, false) then null
    else v_quota ->> 'mode'
  end;

  if not v_allowed then
    update public.antonia_quota_operations operation
    set quota_scope = case when v_quota ->> 'mode' = 'team' then 'organization' else 'user' end,
        quota_allowed = false, quota_count_after = v_count, quota_limit = v_limit,
        credit_mode = v_credit_mode,
        credit_group_id = nullif(v_quota ->> 'group_id', '')::uuid,
        credit_user_policy_id = nullif(v_quota ->> 'user_policy_id', '')::uuid,
        credit_team_policy_id = nullif(v_quota ->> 'team_policy_id', '')::uuid,
        consumed_count = 0, status = 'failed', claim_token = null, completed_at = now(),
        response_status = 429,
        response_payload = jsonb_build_object(
          'error', 'DAILY_ENRICHMENT_QUOTA_EXCEEDED', 'resource', p_resource,
          'count', v_count, 'limit', v_limit,
          'retryAt', ((v_day + 1)::timestamp at time zone 'UTC')
        ), updated_at = now()
    where operation.id = v_operation.id
    returning * into v_operation;
  else
    update public.antonia_quota_operations operation
    set quota_scope = case when v_quota ->> 'mode' = 'team' then 'organization' else 'user' end,
        quota_allowed = true, quota_count_after = v_count, quota_limit = v_limit,
        credit_mode = v_credit_mode,
        credit_group_id = nullif(v_quota ->> 'group_id', '')::uuid,
        credit_user_policy_id = nullif(v_quota ->> 'user_policy_id', '')::uuid,
        credit_team_policy_id = nullif(v_quota ->> 'team_policy_id', '')::uuid,
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
    'mode', v_quota ->> 'mode',
    'group_id', v_operation.credit_group_id,
    'response_status', v_operation.response_status,
    'response_payload', v_operation.response_payload
  );
end;
$$;

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
  if not found then return false; end if;

  if v_operation.quota_allowed and v_operation.consumed_count > 0 then
    if v_operation.credit_mode is not null then
      if not public.release_antonia_organization_credits_v2(
        v_operation.organization_id, v_operation.user_id, v_operation.quota_day,
        v_operation.resource, v_operation.consumed_count,
        v_operation.credit_mode, v_operation.credit_group_id
      ) then
        raise exception 'organization credit bucket is missing for operation release' using errcode = '55000';
      end if;
    elsif v_operation.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_operation.user_id, v_operation.quota_day,
        v_operation.resource, v_operation.consumed_count
      ) then
        raise exception 'legacy shared credit bucket is missing for operation release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_enriched = greatest(0, usage.leads_enriched - case when v_operation.resource = 'enrich' then v_operation.consumed_count else 0 end),
          leads_investigated = greatest(0, usage.leads_investigated - case when v_operation.resource = 'investigate' then v_operation.consumed_count else 0 end),
          updated_at = now()
      where usage.organization_id = v_operation.organization_id and usage.date = v_operation.quota_day;
      if not found then
        raise exception 'legacy organization quota bucket is missing for operation release' using errcode = '55000';
      end if;
    end if;
  end if;
  return true;
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
  v_status jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_tool_run_id is null or p_organization_id is null or p_user_id is null then
    raise exception 'invalid SUPLIA research credit input' using errcode = '22023';
  end if;

  select run.* into v_run
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

  select operation.* into v_operation
  from public.antonia_suplia_research_credit_operations operation
  where operation.tool_run_id = v_run.id;
  if found then
    if v_operation.organization_id <> p_organization_id or v_operation.user_id <> p_user_id then
      raise exception 'SUPLIA research credit operation identity changed' using errcode = '55000';
    end if;
    v_status := public.get_antonia_credit_status_v2(
      p_organization_id, p_user_id, v_operation.quota_day
    );
    return v_status || jsonb_build_object('allowed', true, 'reused', true);
  end if;

  v_quota := public.consume_antonia_organization_credits_v2(
    p_organization_id, p_user_id, 'investigate', 1
  );
  if coalesce((v_quota ->> 'allowed')::boolean, false) then
    insert into public.antonia_suplia_research_credit_operations (
      tool_run_id, organization_id, user_id, quota_day, consumed_at,
      credit_mode, credit_group_id, credit_user_policy_id, credit_team_policy_id
    ) values (
      v_run.id, p_organization_id, p_user_id, v_day, now(),
      case when coalesce((v_quota ->> 'legacy')::boolean, false) then null else v_quota ->> 'mode' end,
      nullif(v_quota ->> 'group_id', '')::uuid,
      nullif(v_quota ->> 'user_policy_id', '')::uuid,
      nullif(v_quota ->> 'team_policy_id', '')::uuid
    );
  end if;
  return v_quota || jsonb_build_object('reused', false);
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

  select job.* into v_job
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
    return public.get_antonia_credit_status_v2(p_organization_id, p_user_id, v_job.quota_day)
      || jsonb_build_object('allowed', true, 'reused', true);
  end if;

  v_quota := public.consume_antonia_organization_credits_v2(
    p_organization_id, p_user_id, 'investigate', 1
  );
  if not coalesce((v_quota ->> 'allowed')::boolean, false) then
    return v_quota || jsonb_build_object('reused', false);
  end if;

  update public.lead_research_jobs
  set quota_consumed_at = now(),
      quota_day = v_day,
      quota_scope = case when v_quota ->> 'mode' = 'team' then 'organization' else 'user' end,
      credit_mode = case when coalesce((v_quota ->> 'legacy')::boolean, false) then null else v_quota ->> 'mode' end,
      credit_group_id = nullif(v_quota ->> 'group_id', '')::uuid,
      credit_user_policy_id = nullif(v_quota ->> 'user_policy_id', '')::uuid,
      credit_team_policy_id = nullif(v_quota ->> 'team_policy_id', '')::uuid,
      updated_at = now()
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
  if not found then return false; end if;

  if v_job.request_claim_state = 'pre_provider' and v_job.quota_consumed_at is not null then
    if v_job.credit_mode is not null then
      if not public.release_antonia_organization_credits_v2(
        v_job.organization_id, v_job.user_id, v_job.quota_day,
        'investigate', 1, v_job.credit_mode, v_job.credit_group_id
      ) then
        raise exception 'organization credit bucket is missing for research release' using errcode = '55000';
      end if;
    elsif v_job.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_job.user_id, v_job.quota_day, 'investigate', 1
      ) then
        raise exception 'legacy shared credit bucket is missing for research release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_investigated = usage.leads_investigated - 1, updated_at = now()
      where usage.organization_id = v_job.organization_id
        and usage.date = v_job.quota_day
        and usage.leads_investigated > 0;
      if not found then
        raise exception 'legacy organization quota bucket is missing for research release' using errcode = '55000';
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
      credit_mode = case when v_job.request_claim_state = 'pre_provider' then null else credit_mode end,
      credit_group_id = case when v_job.request_claim_state = 'pre_provider' then null else credit_group_id end,
      credit_user_policy_id = case when v_job.request_claim_state = 'pre_provider' then null else credit_user_policy_id end,
      credit_team_policy_id = case when v_job.request_claim_state = 'pre_provider' then null else credit_team_policy_id end,
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
  if not found or v_email = '' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  select job.* into v_job
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id is not distinct from p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
    and job.request_claim_token = p_claim_token
    and lower(trim(coalesce(job.email, ''))) = v_email
  for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.unsubscribed_emails email
    where lower(trim(coalesce(email.email, ''))) = v_email
      and ((email.user_id is null and email.organization_id is null)
        or email.user_id = p_user_id or email.organization_id = p_organization_id)
  ) then return false; end if;

  if v_job.request_claim_state = 'pre_provider' and v_job.quota_consumed_at is not null then
    if v_job.credit_mode is not null then
      if not public.release_antonia_organization_credits_v2(
        v_job.organization_id, v_job.user_id, v_job.quota_day,
        'investigate', 1, v_job.credit_mode, v_job.credit_group_id
      ) then
        raise exception 'organization credit bucket is missing for suppressed research release' using errcode = '55000';
      end if;
    elsif v_job.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_job.user_id, v_job.quota_day, 'investigate', 1
      ) then
        raise exception 'legacy shared credit bucket is missing for suppressed research release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage usage
      set leads_investigated = usage.leads_investigated - 1, updated_at = now()
      where usage.organization_id = p_organization_id
        and usage.date = v_job.quota_day
        and usage.leads_investigated > 0;
      if not found then
        raise exception 'legacy organization quota bucket is missing for suppressed research release' using errcode = '55000';
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
      credit_mode = case when v_job.request_claim_state = 'pre_provider' then null else credit_mode end,
      credit_group_id = case when v_job.request_claim_state = 'pre_provider' then null else credit_group_id end,
      credit_user_policy_id = case when v_job.request_claim_state = 'pre_provider' then null else credit_user_policy_id end,
      credit_team_policy_id = case when v_job.request_claim_state = 'pre_provider' then null else credit_team_policy_id end,
      status = 'failed',
      error_code = 'privacy_suppressed',
      error_message = 'Research was cancelled because the recipient is suppressed.',
      result_payload = jsonb_build_object('provider_status', 'failed', 'error', 'privacy_suppressed'),
      attempt_count = greatest(coalesce(attempt_count, 0), 1),
      started_at = coalesce(started_at, now()),
      completed_at = now(),
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select callback.* into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id;
  if not found then return false; end if;

  select operation.* into v_operation
  from public.antonia_quota_operations operation
  where operation.organization_id = v_callback.organization_id
    and operation.user_id = v_callback.user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_callback.operation_id
    and operation.status = 'submitted'
  for update;
  if not found or v_operation.claim_token is null then return false; end if;

  select count(*) into v_remaining_callbacks
  from public.apollo_enrichment_callbacks callback
  where callback.organization_id = v_callback.organization_id
    and callback.user_id = v_callback.user_id
    and callback.quota_resource = v_callback.quota_resource
    and callback.operation_id = v_callback.operation_id
    and callback.status <> 'terminal';
  if v_remaining_callbacks > 0 then return false; end if;

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
    if v_operation.credit_mode is not null then
      if not public.release_antonia_organization_credits_v2(
        v_operation.organization_id, v_operation.user_id, v_operation.quota_day,
        v_operation.resource, v_refund_count,
        v_operation.credit_mode, v_operation.credit_group_id
      ) then
        raise exception 'organization credit bucket is missing during partial refund' using errcode = '55000';
      end if;
    elsif v_operation.quota_scope = 'user' then
      if not public.release_antonia_user_daily_credits_v1(
        v_operation.user_id, v_operation.quota_day,
        v_operation.resource, v_refund_count
      ) then
        raise exception 'legacy shared credit bucket is missing during partial refund' using errcode = '55000';
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
      if not found then
        raise exception 'legacy organization quota bucket is missing during partial refund' using errcode = '55000';
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

revoke all on function public.consume_antonia_daily_quota_v1(uuid, uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_antonia_quota_operation_v1(uuid, uuid, text, text, text, text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.release_antonia_quota_operation_v1(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_suplia_research_tool_credit_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_lead_research_request_quota_v1(uuid, text, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.settle_apollo_enrichment_quota_if_ready_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_antonia_daily_quota_v1(uuid, uuid, text, text, integer, integer) to service_role;
grant execute on function public.claim_antonia_quota_operation_v1(uuid, uuid, text, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.release_antonia_quota_operation_v1(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.consume_suplia_research_tool_credit_v1(uuid, uuid, uuid) to service_role;
grant execute on function public.consume_lead_research_request_quota_v1(uuid, text, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.release_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid) to service_role;
grant execute on function public.settle_apollo_enrichment_quota_if_ready_v1(uuid) to service_role;

notify pgrst, 'reload schema';
