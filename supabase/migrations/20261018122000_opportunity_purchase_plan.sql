-- «Demanda futura»: the lines of ChileCompra's Plan Anual de Compras (open data, one file a year) that the AI kept for the
-- workspace's offer, with the reason. Each reading of a year replaces the lines of the previous one (run_id). Public data,
-- scoped by organization because the selection is that organization's.
create table public.opportunity_purchase_plan (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  year integer not null check (year between 2015 and 2100),
  line_id text not null check (line_id ~ '^[a-f0-9]{16,64}$'),
  run_id uuid not null,
  institution text not null check (length(institution) between 1 and 300),
  institution_code text check (length(institution_code) <= 40),
  product_code text check (length(product_code) <= 40),
  description text not null check (length(description) between 1 and 600),
  quantity numeric check (quantity >= 0),
  unit_amount numeric check (unit_amount >= 0),
  amount numeric check (amount >= 0),
  month smallint check (month between 1 and 12),
  quarter smallint check (quarter between 1 and 4),
  fit text not null check (fit in ('alta', 'media')),
  reason text not null default '' check (length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (organization_id, year, line_id)
);
create index opportunity_purchase_plan_amount_idx on public.opportunity_purchase_plan (organization_id, year, amount desc nulls last);

alter table public.opportunity_purchase_plan enable row level security;
revoke all on public.opportunity_purchase_plan from public, anon, authenticated;
grant all on public.opportunity_purchase_plan to service_role;

notify pgrst, 'reload schema';
