-- «Contactos de la semana» (20 oct 2026): the five contacts each person gets on Tuesdays and Fridays, kept once per person,
-- organization and day (src/lib/server/lead-drops.ts). Each item holds what the person sees before saving it (name, role,
-- company, why it fits, a brief research and a first email); the email and the phone stay encrypted in lead_search_vault.
create table if not exists public.lead_drops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  drop_date date not null,
  status text not null check (status in ('pending', 'ready', 'sent', 'empty', 'failed')),
  criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  cost_usd numeric(8, 4) not null default 0 check (cost_usd >= 0),
  error text check (error is null or length(error) <= 300),
  emailed_at timestamptz,
  opened_at timestamptz,
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, drop_date)
);

create index if not exists lead_drops_pending_idx on public.lead_drops (drop_date, status) where status in ('pending', 'ready');

alter table public.lead_drops enable row level security;
revoke all on public.lead_drops from public, anon, authenticated;
grant all on public.lead_drops to service_role;

notify pgrst, 'reload schema';
