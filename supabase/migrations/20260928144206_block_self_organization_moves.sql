-- Applied in production on 2026-09-28 and missing from this repository until the schema comparison of 2026-11-11: a person no
-- longer creates a second organization or leaves one on their own; an administrator assigns it.
create or replace function public.create_new_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('organization-user:' || current_user_id::text, 0));
  if exists (select 1 from public.organization_members where user_id = current_user_id) then
    raise exception 'An administrator must assign your organization' using errcode = '42501';
  end if;
  if nullif(btrim(org_name), '') is null or length(btrim(org_name)) > 120 then
    raise exception 'Invalid organization name' using errcode = '22023';
  end if;
  insert into public.organizations (name) values (btrim(org_name)) returning id into new_org_id;
  insert into public.organization_members (organization_id, user_id, role)
  values (new_org_id, current_user_id, 'owner');
  return new_org_id;
end;
$$;
revoke execute on function public.leave_organization_v1(uuid) from public, anon, authenticated;
