create table public.search_workspace_checkpoints (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  check (jsonb_typeof(snapshot) = 'object'),
  check (octet_length(snapshot::text) <= 4000000)
);
alter table public.search_workspace_checkpoints enable row level security;
revoke all on public.search_workspace_checkpoints from public, anon, authenticated;
grant select, insert, update on public.search_workspace_checkpoints to service_role;
