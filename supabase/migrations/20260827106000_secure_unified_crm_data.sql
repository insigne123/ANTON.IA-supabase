-- Remove every legacy policy before installing the tenant-scoped contract.
-- PostgreSQL combines permissive policies with OR, so name-based partial
-- cleanup is not sufficient when hosted policy names have drifted.
alter table public.unified_crm_data enable row level security;

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'unified_crm_data'
  loop execute format('drop policy if exists %I on public.unified_crm_data', p.policyname); end loop;
end;
$$;

revoke all on table public.unified_crm_data from public, anon, authenticated;
grant select, insert, update, delete on table public.unified_crm_data to authenticated;
grant all on table public.unified_crm_data to service_role;

create policy "Organization members can read unified CRM data"
  on public.unified_crm_data
  for select
  to authenticated
  using (public.is_current_user_organization_member(organization_id));

create policy "Organization members can insert unified CRM data"
  on public.unified_crm_data
  for insert
  to authenticated
  with check (public.is_current_user_organization_member(organization_id));

create policy "Organization members can update unified CRM data"
  on public.unified_crm_data
  for update
  to authenticated
  using (public.is_current_user_organization_member(organization_id))
  with check (public.is_current_user_organization_member(organization_id));

create policy "Organization members can delete unified CRM data"
  on public.unified_crm_data
  for delete
  to authenticated
  using (public.is_current_user_organization_member(organization_id));

comment on table public.unified_crm_data is
  'Shared CRM metadata scoped to members of the row organization.';
