-- «Metas semanales» and «Avisos» (20 oct 2026). The goal of a team (user_id null) and, when an admin gives someone a
-- different one, that person's: how many new contacts with an email to find and how many people to contact each week
-- (src/lib/weekly-goals.ts). And the day's alert of each person, kept once per person, organization and day, so the
-- morning email goes out once however many times the scheduler runs (src/lib/server/daily-alerts.ts).
create table if not exists public.weekly_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  found integer not null check (found between 0 and 500),
  contacted integer not null check (contacted between 0 and 500),
  set_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, user_id)
);

create table if not exists public.daily_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_date date not null,
  status text not null check (status in ('quiet', 'stored', 'sent', 'failed')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  emailed_at timestamptz,
  email_error text check (email_error is null or length(email_error) <= 300),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, alert_date)
);

alter table public.weekly_goals enable row level security;
alter table public.daily_alerts enable row level security;
revoke all on public.weekly_goals, public.daily_alerts from public, anon, authenticated;
grant all on public.weekly_goals, public.daily_alerts to service_role;

notify pgrst, 'reload schema';
