-- «Calcular el precio» on the server (OPP-23): the cost of an hour and the points the price is worth, as whoever sets the prices
-- worked them out for one opportunity. Until now they lived only in that person's browser: another computer lost them and nobody
-- else could check them. One row per saved version: the newest is the one in use, the ones before are its history. Read and written
-- only through the server, after its check (whoever is in charge of the opportunity or an administrator), like the offer drafts.
create table public.opportunity_price_studies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  opportunity_id uuid not null,
  study jsonb not null check (jsonb_typeof(study) = 'object' and pg_column_size(study) <= 131072),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, opportunity_id) references public.commercial_opportunities(organization_id, id) on delete cascade
);
create index opportunity_price_studies_latest_idx on public.opportunity_price_studies (organization_id, opportunity_id, created_at desc);

alter table public.opportunity_price_studies enable row level security;
revoke all on public.opportunity_price_studies from public, anon, authenticated;
grant all on public.opportunity_price_studies to service_role;

notify pgrst, 'reload schema';
