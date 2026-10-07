-- Plan 15: who may open «Oportunidades» in each organization, chosen by its owners and admins in «Administración ›
-- Personas». Until now only OPPORTUNITIES_ALLOWED_EMAILS opened it, and adding someone took a deploy. The list stays as it
-- is (its accounts keep their access); a row here adds a member of that organization. Only the server reads and writes
-- it, after checking that whoever changes it is an owner or admin of the same organization: members get no grant.
create table if not exists public.commercial_opportunity_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.commercial_opportunity_members enable row level security;
revoke all on table public.commercial_opportunity_members from public, anon, authenticated;
grant all on table public.commercial_opportunity_members to service_role;

notify pgrst, 'reload schema';
