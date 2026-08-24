-- Phase 1: close client-side access paths that are not safely tenant-scoped.
-- Axis tables intentionally remain service-role-only until they gain ownership columns.

do $$
begin
  if to_regclass('public.organization_members') is not null then
    execute $function$
      create or replace function public.is_current_user_organization_member(p_organization_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = pg_catalog
      as $body$
        select p_organization_id is not null
          and exists (
            select 1
            from public.organization_members om
            where om.organization_id = p_organization_id
              and om.user_id = auth.uid()
          );
      $body$
    $function$;

    execute $function$
      create or replace function public.current_user_shares_organization(p_user_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = pg_catalog
      as $body$
        select p_user_id = auth.uid()
          or exists (
            select 1
            from public.organization_members current_member
            join public.organization_members profile_member
              on profile_member.organization_id = current_member.organization_id
            where current_member.user_id = auth.uid()
              and profile_member.user_id = p_user_id
          );
      $body$
    $function$;

    revoke all on function public.is_current_user_organization_member(uuid) from public, anon, authenticated;
    revoke all on function public.current_user_shares_organization(uuid) from public, anon, authenticated;
    grant execute on function public.is_current_user_organization_member(uuid) to authenticated, service_role;
    grant execute on function public.current_user_shares_organization(uuid) to authenticated, service_role;
  end if;
end $$;

-- Profiles may be read by the owner and collaborators in a shared organization,
-- never by every authenticated tenant.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles enable row level security';

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and cmd in ('SELECT', 'ALL')
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, 'profiles');
    end loop;

    execute 'revoke all on table public.profiles from public, anon, authenticated';
    execute 'grant select, insert, update on table public.profiles to authenticated';
    execute 'grant all on table public.profiles to service_role';

    if to_regprocedure('public.current_user_shares_organization(uuid)') is not null then
      execute $policy$
        create policy "Tenant members can read profiles"
          on public.profiles
          for select
          to authenticated
          using (
            id = (select auth.uid())
            or public.current_user_shares_organization(id)
          )
      $policy$;
    else
      execute $policy$
        create policy "Users can view their own profile"
          on public.profiles
          for select
          to authenticated
          using (id = (select auth.uid()))
      $policy$;
    end if;
  end if;
end $$;

-- Reply records are server-authored. Authenticated users can only read rows in
-- organizations where they are members.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.lead_responses') is not null then
    execute 'alter table public.lead_responses enable row level security';

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'lead_responses'
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, 'lead_responses');
    end loop;

    execute 'revoke all on table public.lead_responses from public, anon, authenticated';
    execute 'grant select on table public.lead_responses to authenticated';
    execute 'grant all on table public.lead_responses to service_role';

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'lead_responses'
        and column_name = 'organization_id'
    ) and to_regprocedure('public.is_current_user_organization_member(uuid)') is not null then
      execute $policy$
        create policy "Tenant members can read lead responses"
          on public.lead_responses
          for select
          to authenticated
          using (public.is_current_user_organization_member(organization_id))
      $policy$;
    end if;
  end if;
end $$;

-- Saved searches stay user-owned. Shared rows are readable only within their
-- organization and cannot be reassigned to another user or organization.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.saved_searches') is not null then
    execute 'alter table public.saved_searches enable row level security';

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'saved_searches'
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, 'saved_searches');
    end loop;

    execute 'revoke all on table public.saved_searches from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table public.saved_searches to authenticated';
    execute 'grant all on table public.saved_searches to service_role';

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'saved_searches'
        and column_name in ('organization_id', 'user_id', 'is_shared')
      group by table_name
      having count(*) = 3
    ) and to_regprocedure('public.is_current_user_organization_member(uuid)') is not null then
      execute $policy$
        create policy "Users can read owned or shared saved searches"
          on public.saved_searches
          for select
          to authenticated
          using (
            user_id = (select auth.uid())
            or (
              is_shared is true
              and public.is_current_user_organization_member(organization_id)
            )
          )
      $policy$;

      execute $policy$
        create policy "Users can create owned saved searches"
          on public.saved_searches
          for insert
          to authenticated
          with check (
            user_id = (select auth.uid())
            and public.is_current_user_organization_member(organization_id)
          )
      $policy$;

      execute $policy$
        create policy "Users can update owned saved searches"
          on public.saved_searches
          for update
          to authenticated
          using (user_id = (select auth.uid()))
          with check (
            user_id = (select auth.uid())
            and public.is_current_user_organization_member(organization_id)
          )
      $policy$;

      execute $policy$
        create policy "Users can delete owned saved searches"
          on public.saved_searches
          for delete
          to authenticated
          using (user_id = (select auth.uid()))
      $policy$;
    end if;
  end if;
end $$;

-- OAuth refresh tokens are server-only. Connection status is exposed through an
-- authenticated server route that returns provider names, never token material.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.provider_tokens') is not null then
    execute 'alter table public.provider_tokens enable row level security';

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'provider_tokens'
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, 'provider_tokens');
    end loop;

    execute 'revoke all on table public.provider_tokens from public, anon, authenticated';
    execute 'grant all on table public.provider_tokens to service_role';
  end if;
end $$;

-- Browser clients may read organization email event history, but only trusted
-- server and service-role paths can write event records.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.email_events') is not null then
    execute 'alter table public.email_events enable row level security';

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'email_events'
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, 'email_events');
    end loop;

    execute 'revoke all on table public.email_events from public, anon, authenticated';
    execute 'grant select on table public.email_events to authenticated';
    execute 'grant all on table public.email_events to service_role';

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'email_events'
        and column_name = 'organization_id'
    ) and to_regprocedure('public.is_current_user_organization_member(uuid)') is not null then
      execute $policy$
        create policy "Tenant members can read email events"
          on public.email_events
          for select
          to authenticated
          using (public.is_current_user_organization_member(organization_id))
      $policy$;
    end if;
  end if;
end $$;

-- Axis has no user_id or organization_id columns to support a safe browser RLS
-- policy. Keep every core table behind service_role until ownership is modeled.
do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'axis_rondas',
    'axis_empresas',
    'axis_leads',
    'axis_toques',
    'axis_respuestas'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;

    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      table_name || '_service_role_only',
      table_name
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
