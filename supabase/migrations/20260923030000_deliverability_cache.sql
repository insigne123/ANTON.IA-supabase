-- Stage 8 (entregabilidad): caché de 24 h por organización para los registros
-- DNS del dominio remitente. Solo resultados, nunca secretos; el servidor
-- revalida el dominio antes de consultar el DNS.
create table if not exists public.cowork_deliverability_checks (
  organization_id uuid not null,
  domain text not null check (domain <> ''),
  result jsonb not null,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, domain)
);
alter table public.cowork_deliverability_checks enable row level security;
revoke all on table public.cowork_deliverability_checks from public, anon, authenticated;
grant all on table public.cowork_deliverability_checks to service_role;
