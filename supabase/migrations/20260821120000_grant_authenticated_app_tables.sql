-- PostgREST needs table privileges in addition to RLS. Keep these
-- grants scoped to the authenticated role; RLS remains the ownership boundary.
alter table public.leads enable row level security;
alter table public.enriched_leads enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('leads', 'enriched_leads')
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end $$;

create policy "Tenant members can read leads"
  on public.leads for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
create policy "Tenant members can insert leads"
  on public.leads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can update leads"
  on public.leads for update to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  )
  with check (
    (user_id = (select auth.uid()) or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can delete leads"
  on public.leads for delete to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

create policy "Tenant members can read enriched leads"
  on public.enriched_leads for select to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );
create policy "Tenant members can insert enriched leads"
  on public.enriched_leads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can update enriched leads"
  on public.enriched_leads for update to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  )
  with check (
    (user_id = (select auth.uid()) or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
    and (organization_id is null or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    ))
  );
create policy "Tenant members can delete enriched leads"
  on public.enriched_leads for delete to authenticated
  using (
    user_id = (select auth.uid())
    or organization_id in (
      select om.organization_id from public.organization_members om where om.user_id = (select auth.uid())
    )
  );

revoke all on table public.leads, public.enriched_leads from public, anon, authenticated;
grant select, insert, update, delete on table public.leads to authenticated;
grant select, insert, update, delete on table public.enriched_leads to authenticated;
grant select, insert, update, delete on table public.contacted_leads to authenticated;
grant select, insert, update, delete on table public.saved_searches to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.organization_members to authenticated;
