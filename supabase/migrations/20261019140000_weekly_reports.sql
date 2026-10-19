-- «Informe semanal» (propuesta 2, 19 oct 2026): the report of a past week, kept once per person, organization and week, so
-- Monday's email goes out once however many times the scheduler runs (src/lib/server/weekly-report.ts). And who manages
-- Oportunidades: the people an admin names receive its section; while there are none, the admins do.
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  emailed_at timestamptz,
  email_error text check (email_error is null or length(email_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, week_start)
);

create table if not exists public.organization_report_roles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('opportunities')),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, role)
);

alter table public.weekly_reports enable row level security;
alter table public.organization_report_roles enable row level security;
revoke all on public.weekly_reports, public.organization_report_roles from public, anon, authenticated;
grant all on public.weekly_reports, public.organization_report_roles to service_role;

notify pgrst, 'reload schema';
