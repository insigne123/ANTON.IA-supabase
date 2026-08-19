-- Derived daily rollups for low-cost observability and usage mining queries.

create table if not exists public.antonia_event_rollups_daily (
  id uuid primary key default gen_random_uuid(),
  bucket_date date not null,
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  provider text,
  status text,
  outcome text,
  source_system text not null,
  source_confidence text not null default 'observed',
  event_count bigint not null,
  total_duration_ms bigint not null default 0,
  first_occurred_at timestamptz not null,
  last_occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  constraint antonia_event_rollups_daily_count_check
    check (event_count > 0),
  constraint antonia_event_rollups_daily_duration_check
    check (total_duration_ms >= 0),
  constraint antonia_event_rollups_daily_confidence_check
    check (source_confidence in ('observed', 'derived', 'backfill', 'unknown_actor', 'diagnostic_test')),
  constraint antonia_event_rollups_daily_range_check
    check (first_occurred_at <= last_occurred_at)
);

create unique index if not exists antonia_event_rollups_daily_dimensions_uidx
  on public.antonia_event_rollups_daily (
    bucket_date,
    coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    event_type,
    coalesce(provider, '__NULL__'),
    coalesce(status, '__NULL__'),
    coalesce(outcome, '__NULL__'),
    source_system,
    source_confidence
  );

create index if not exists antonia_event_rollups_daily_org_idx
  on public.antonia_event_rollups_daily(organization_id, bucket_date desc);

create index if not exists antonia_event_rollups_daily_type_idx
  on public.antonia_event_rollups_daily(event_type, bucket_date desc);

create or replace function public.refresh_antonia_event_rollups_daily_v1(
  p_from date default (current_date - 7),
  p_to date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid rollup date range' using errcode = '22023';
  end if;

  if p_to - p_from > 366 then
    raise exception 'rollup date range is too large' using errcode = '22023';
  end if;

  delete from public.antonia_event_rollups_daily
  where bucket_date between p_from and p_to;

  insert into public.antonia_event_rollups_daily (
    bucket_date,
    organization_id,
    actor_user_id,
    event_type,
    provider,
    status,
    outcome,
    source_system,
    source_confidence,
    event_count,
    total_duration_ms,
    first_occurred_at,
    last_occurred_at,
    refreshed_at
  )
  select
    (e.occurred_at at time zone 'UTC')::date,
    e.organization_id,
    e.actor_user_id,
    e.event_type,
    e.provider,
    e.status,
    e.outcome,
    e.source_system,
    e.source_confidence,
    count(*)::bigint,
    coalesce(sum(greatest(coalesce(e.duration_ms, 0), 0)), 0)::bigint,
    min(e.occurred_at),
    max(e.occurred_at),
    now()
  from public.antonia_event_ledger e
  where e.occurred_at >= (p_from::timestamp at time zone 'UTC')
    and e.occurred_at < ((p_to::timestamp + interval '1 day') at time zone 'UTC')
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

  get diagnostics v_row_count = row_count;
  return v_row_count;
end;
$$;

create or replace function public.query_antonia_event_rollups_daily_v1(
  p_organization_id uuid default null,
  p_actor_user_id uuid default null,
  p_event_type text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 1000
)
returns setof public.antonia_event_rollups_daily
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select r.*
  from public.antonia_event_rollups_daily r
  where (p_organization_id is null or r.organization_id = p_organization_id)
    and (p_actor_user_id is null or r.actor_user_id = p_actor_user_id)
    and (p_event_type is null or r.event_type = nullif(trim(p_event_type), ''))
    and (p_from is null or r.bucket_date >= p_from)
    and (p_to is null or r.bucket_date <= p_to)
  order by r.bucket_date desc, r.event_count desc, r.event_type, r.id
  limit greatest(1, least(coalesce(p_limit, 1000), 5000));
end;
$$;

-- Populate all historical buckets once in bounded windows. Future refreshes replace only their requested date range.
do $$
declare
  v_from date := date '1970-01-01';
  v_to date;
begin
  while v_from <= current_date loop
    v_to := least(v_from + 365, current_date);
    perform public.refresh_antonia_event_rollups_daily_v1(v_from, v_to);
    v_from := v_to + 1;
  end loop;
end;
$$;

alter table public.antonia_event_rollups_daily enable row level security;
revoke all on table public.antonia_event_rollups_daily from public, anon, authenticated;
grant select on table public.antonia_event_rollups_daily to service_role;

revoke all on function public.refresh_antonia_event_rollups_daily_v1(date, date) from public, anon, authenticated;
revoke all on function public.query_antonia_event_rollups_daily_v1(uuid, uuid, text, date, date, integer) from public, anon, authenticated;
grant execute on function public.refresh_antonia_event_rollups_daily_v1(date, date) to service_role;
grant execute on function public.query_antonia_event_rollups_daily_v1(uuid, uuid, text, date, date, integer) to service_role;

notify pgrst, 'reload schema';
