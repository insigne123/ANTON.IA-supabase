-- The feature remains disabled until the service-owned rollout RPC passes all
-- production safety checks for an individual organization.
alter table public.organizations
  add column if not exists collaboration_v1_enabled boolean not null default false;

create or replace function public.guard_organization_collaboration_flag_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.collaboration_v1_enabled is distinct from old.collaboration_v1_enabled
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Collaboration rollout is service-owned' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_organization_collaboration_flag on public.organizations;
create trigger guard_organization_collaboration_flag
  before update of collaboration_v1_enabled on public.organizations
  for each row execute function public.guard_organization_collaboration_flag_v1();

notify pgrst, 'reload schema';
