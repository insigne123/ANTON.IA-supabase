-- Forward-only. Saved audience profiles (owner RLS writes) and daily AI assist budgets.
create table public.bulk_audience_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bulk_audience_profiles_owner_idx on public.bulk_audience_profiles(organization_id, user_id, created_at desc);
alter table public.bulk_audience_profiles enable row level security;
create policy bulk_audience_profiles_owner_read on public.bulk_audience_profiles for select to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_audience_profiles.organization_id and om.user_id = auth.uid()
  ));
create policy bulk_audience_profiles_owner_insert on public.bulk_audience_profiles for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_audience_profiles.organization_id and om.user_id = auth.uid()
  ));
create policy bulk_audience_profiles_owner_update on public.bulk_audience_profiles for update to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_audience_profiles.organization_id and om.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_audience_profiles.organization_id and om.user_id = auth.uid()
  ));
create policy bulk_audience_profiles_owner_delete on public.bulk_audience_profiles for delete to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.organization_members om where om.organization_id = bulk_audience_profiles.organization_id and om.user_id = auth.uid()
  ));
grant select, insert, update, delete on public.bulk_audience_profiles to authenticated;
grant all on public.bulk_audience_profiles to service_role;

create table public.bulk_ai_assist_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 1 check (count > 0),
  primary key (organization_id, user_id, day)
);
alter table public.bulk_ai_assist_usage enable row level security;
revoke all on public.bulk_ai_assist_usage from anon, authenticated;
grant all on public.bulk_ai_assist_usage to service_role;

create function public.consume_bulk_ai_assist_v1(p_organization_id uuid, p_user_id uuid, p_day date, p_limit integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists (
    select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_user_id
  ) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 then raise exception 'INVALID_AI_BUDGET'; end if;
  insert into public.bulk_ai_assist_usage(organization_id, user_id, day, count)
    values (p_organization_id, p_user_id, p_day, 1)
    on conflict (organization_id, user_id, day) do update set count = bulk_ai_assist_usage.count + 1
    returning count into v_count;
  return p_limit - v_count;
end;
$$;
revoke all on function public.consume_bulk_ai_assist_v1(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.consume_bulk_ai_assist_v1(uuid, uuid, date, integer) to service_role;
