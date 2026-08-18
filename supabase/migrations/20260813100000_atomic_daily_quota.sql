-- Atomically enforce organization and user-scoped enrichment/research quotas.

alter table public.user_quota_overrides
  add column if not exists daily_enrich_limit integer,
  add column if not exists daily_investigate_limit integer;

alter table public.user_quota_overrides
  drop constraint if exists user_quota_overrides_daily_enrich_limit_check,
  drop constraint if exists user_quota_overrides_daily_investigate_limit_check;

alter table public.user_quota_overrides
  add constraint user_quota_overrides_daily_enrich_limit_check
    check (daily_enrich_limit is null or daily_enrich_limit > 0),
  add constraint user_quota_overrides_daily_investigate_limit_check
    check (daily_investigate_limit is null or daily_investigate_limit > 0);

revoke insert, update, delete, truncate on table public.user_quota_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.user_quota_overrides to service_role;

create table if not exists public.antonia_user_daily_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  resource text not null,
  usage_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, date, resource),
  constraint antonia_user_daily_usage_resource_check
    check (resource in ('enrich', 'investigate')),
  constraint antonia_user_daily_usage_count_check
    check (usage_count >= 0)
);

alter table public.antonia_user_daily_usage enable row level security;
revoke all on table public.antonia_user_daily_usage from public, anon, authenticated;
grant select on table public.antonia_user_daily_usage to service_role;

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
  v_day date := timezone('utc', now())::date;
  v_resource text := case when p_resource = 'research' then 'investigate' else p_resource end;
  v_current integer := 0;
  v_baseline integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_user_id is null
    or p_scope is null
    or p_scope not in ('organization', 'user')
    or p_resource is null
    or p_resource not in ('leadSearch', 'search', 'enrich', 'investigate', 'research')
    or p_requested_count is null
    or p_requested_count <= 0
    or p_limit is null
    or p_limit < 0 then
    raise exception 'invalid daily quota input' using errcode = '22023';
  end if;
  if p_scope = 'user' and v_resource not in ('enrich', 'investigate') then
    raise exception 'resource does not support user quota scope' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'quota user does not belong to organization' using errcode = '22023';
  end if;

  if p_scope = 'user' then
    if v_resource = 'enrich' then
      select least(count(*), 2147483647)::integer
      into v_baseline
      from public.leads l
      where l.organization_id = p_organization_id
        and l.user_id = p_user_id
        and l.last_enriched_at >= (v_day::timestamp at time zone 'UTC');
    else
      select least(count(*), 2147483647)::integer
      into v_baseline
      from public.leads l
      where l.organization_id = p_organization_id
        and l.user_id = p_user_id
        and l.last_investigated_at >= (v_day::timestamp at time zone 'UTC');
    end if;

    insert into public.antonia_user_daily_usage (
      organization_id, user_id, date, resource, usage_count
    ) values (
      p_organization_id, p_user_id, v_day, v_resource, v_baseline
    ) on conflict (organization_id, user_id, date, resource) do nothing;

    select u.usage_count
    into v_current
    from public.antonia_user_daily_usage u
    where u.organization_id = p_organization_id
      and u.user_id = p_user_id
      and u.date = v_day
      and u.resource = v_resource
    for update;

    if not found then
      raise exception 'user daily quota bucket is missing' using errcode = '55000';
    end if;
    if v_current > p_limit - p_requested_count then
      return jsonb_build_object('allowed', false, 'count', v_current, 'limit', p_limit);
    end if;

    update public.antonia_user_daily_usage
    set usage_count = usage_count + p_requested_count,
        updated_at = now()
    where organization_id = p_organization_id
      and user_id = p_user_id
      and date = v_day
      and resource = v_resource;
  else
    insert into public.antonia_daily_usage (organization_id, date)
    values (p_organization_id, v_day)
    on conflict (organization_id, date) do nothing;

    select case v_resource
      when 'leadSearch' then u.leads_searched
      when 'search' then u.search_runs
      when 'enrich' then u.leads_enriched
      when 'investigate' then u.leads_investigated
    end
    into v_current
    from public.antonia_daily_usage u
    where u.organization_id = p_organization_id
      and u.date = v_day
    for update;

    if not found or v_current is null then
      raise exception 'organization daily quota row is missing' using errcode = '55000';
    end if;
    if v_current > p_limit - p_requested_count then
      return jsonb_build_object('allowed', false, 'count', v_current, 'limit', p_limit);
    end if;

    update public.antonia_daily_usage
    set leads_searched = leads_searched + case when v_resource = 'leadSearch' then p_requested_count else 0 end,
        search_runs = search_runs + case when v_resource = 'search' then p_requested_count else 0 end,
        leads_enriched = leads_enriched + case when v_resource = 'enrich' then p_requested_count else 0 end,
        leads_investigated = leads_investigated + case when v_resource = 'investigate' then p_requested_count else 0 end,
        updated_at = now()
    where organization_id = p_organization_id
      and date = v_day;
  end if;

  v_current := v_current + p_requested_count;
  return jsonb_build_object('allowed', true, 'count', v_current, 'limit', p_limit);
end;
$$;

revoke all on function public.consume_antonia_daily_quota_v1(uuid, uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_antonia_daily_quota_v1(uuid, uuid, text, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
