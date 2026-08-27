-- Close legacy PostgREST access while preserving the existing server and
-- organization-member workflows.

alter table public.antonia_exceptions enable row level security;

revoke all on table public.antonia_exceptions from public, anon, authenticated;
grant all on table public.antonia_exceptions to service_role;

comment on table public.antonia_exceptions is
  'Server-owned Antonia exception queue. Client roles have no direct access.';

alter table public.unified_crm_data enable row level security;

revoke all on table public.unified_crm_data from public, anon, authenticated;
grant select, insert, update, delete on table public.unified_crm_data to authenticated;
grant all on table public.unified_crm_data to service_role;

drop policy if exists "Organization members can read unified CRM data"
  on public.unified_crm_data;
drop policy if exists "Organization members can insert unified CRM data"
  on public.unified_crm_data;
drop policy if exists "Organization members can update unified CRM data"
  on public.unified_crm_data;
drop policy if exists "Organization members can delete unified CRM data"
  on public.unified_crm_data;

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
