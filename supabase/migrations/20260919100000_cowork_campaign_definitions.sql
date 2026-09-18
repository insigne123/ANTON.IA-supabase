-- Fase 2D: definiciones de campaña en espera. La fila la escribe el worker con
-- service_role al proponer y se lee exactamente una vez al ejecutar; el ciclo
-- aprobar/rechazar/ejecutar vive en la maquinaria generica de efectos.
create table public.cowork_campaign_definitions (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  definition jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.cowork_campaign_definitions enable row level security;
revoke all on public.cowork_campaign_definitions from anon, authenticated;
grant select on public.cowork_campaign_definitions to authenticated;
grant all on public.cowork_campaign_definitions to service_role;
create policy cowork_campaign_definitions_private on public.cowork_campaign_definitions for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));
