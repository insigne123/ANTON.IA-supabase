-- Organization-scoped admin reporting, group membership, and secure role checks.

create table if not exists public.organization_reporting_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  country_code text,
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_reporting_groups_name_check
    check (length(trim(name)) between 2 and 80),
  constraint organization_reporting_groups_slug_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint organization_reporting_groups_unique_slug
    unique (organization_id, slug)
);

create table if not exists public.organization_reporting_group_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.organization_reporting_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  primary key (group_id, user_id)
);

create index if not exists organization_reporting_groups_org_idx
  on public.organization_reporting_groups(organization_id, is_active, name);

create index if not exists organization_reporting_group_members_user_idx
  on public.organization_reporting_group_members(organization_id, user_id, unassigned_at);

create index if not exists organization_reporting_group_members_group_idx
  on public.organization_reporting_group_members(group_id, unassigned_at, user_id);

create or replace function public.validate_reporting_group_member_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.organization_reporting_groups g
    where g.id = new.group_id
      and g.organization_id = new.organization_id
  ) then
    raise exception 'reporting group does not belong to organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_reporting_group_member_organization_trigger
  on public.organization_reporting_group_members;
create trigger validate_reporting_group_member_organization_trigger
  before insert or update on public.organization_reporting_group_members
  for each row execute function public.validate_reporting_group_member_organization();

create unique index if not exists organization_reporting_group_members_primary_uidx
  on public.organization_reporting_group_members(organization_id, user_id)
  where is_primary = true and unassigned_at is null;

create or replace function public.is_organization_admin(
  p_organization_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = coalesce(p_user_id, auth.uid())
      and om.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_organization_admin(uuid, uuid) from public, anon;
grant execute on function public.is_organization_admin(uuid, uuid) to authenticated, service_role;

-- The previous emergency policy allowed any authenticated user to insert a
-- membership row with an arbitrary role. Membership changes must go through
-- trusted invite/admin flows instead.
drop policy if exists "Insert self" on public.organization_members;
revoke insert, update, delete on public.organization_members from authenticated;

alter table public.organization_reporting_groups enable row level security;
alter table public.organization_reporting_group_members enable row level security;

drop policy if exists "Organization admins can view reporting groups" on public.organization_reporting_groups;
create policy "Organization admins can view reporting groups"
  on public.organization_reporting_groups for select
  using (public.is_organization_admin(organization_id));

drop policy if exists "Organization admins can manage reporting groups" on public.organization_reporting_groups;
create policy "Organization admins can manage reporting groups"
  on public.organization_reporting_groups for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

drop policy if exists "Organization admins can view reporting group members" on public.organization_reporting_group_members;
create policy "Organization admins can view reporting group members"
  on public.organization_reporting_group_members for select
  using (public.is_organization_admin(organization_id));

drop policy if exists "Organization admins can manage reporting group members" on public.organization_reporting_group_members;
create policy "Organization admins can manage reporting group members"
  on public.organization_reporting_group_members for all
  using (public.is_organization_admin(organization_id))
  with check (public.is_organization_admin(organization_id));

grant select on public.organization_reporting_groups to authenticated;
grant select on public.organization_reporting_group_members to authenticated;
grant all on public.organization_reporting_groups to service_role;
grant all on public.organization_reporting_group_members to service_role;

-- Default operational groups for the first GrupoExpro organization. Other
-- organizations can create their own groups from the admin portal.
insert into public.organization_reporting_groups (organization_id, name, slug, country_code, color)
select o.id, seed.name, seed.slug, seed.country_code, seed.color
from public.organizations o
cross join (
  values
    ('Chile', 'chile', 'CL', '#2563eb'),
    ('Peru', 'peru', 'PE', '#0f766e'),
    ('Colombia', 'colombia', 'CO', '#d97706')
) as seed(name, slug, country_code, color)
where lower(trim(o.name)) = 'grupoexpro'
on conflict (organization_id, slug) do nothing;

alter table public.antonia_event_ledger
  add column if not exists reporting_group_id uuid references public.organization_reporting_groups(id) on delete set null;

create index if not exists antonia_event_ledger_reporting_group_idx
  on public.antonia_event_ledger(reporting_group_id, occurred_at desc)
  where reporting_group_id is not null;

notify pgrst, 'reload schema';
