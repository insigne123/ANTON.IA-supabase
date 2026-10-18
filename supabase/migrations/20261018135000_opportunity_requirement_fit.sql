-- «¿Cumplimos?»: each requirement of a report as meets, a missing fact (with its question) or does not meet, against one
-- version of the company's tender profile. Read and written through the server only.
create table public.opportunity_requirement_fit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  report_id uuid not null references public.opportunity_reports(id) on delete cascade,
  profile_revision bigint not null check (profile_revision >= 1),
  items jsonb not null check (jsonb_typeof(items) = 'object' and pg_column_size(items) <= 131072),
  no_rests_on_requirements boolean not null default false,
  created_at timestamptz not null default now(),
  unique (report_id, profile_revision),
  foreign key (organization_id, opportunity_id) references public.commercial_opportunities(organization_id, id) on delete cascade
);
create index opportunity_requirement_fit_report_idx on public.opportunity_requirement_fit (report_id, created_at desc);

alter table public.opportunity_requirement_fit enable row level security;
revoke all on public.opportunity_requirement_fit from public, anon, authenticated;
grant all on public.opportunity_requirement_fit to service_role;

notify pgrst, 'reload schema';
