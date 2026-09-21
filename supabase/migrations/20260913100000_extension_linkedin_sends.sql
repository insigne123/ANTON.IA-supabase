-- Durable, scoped authorization and history for user-confirmed browser sends.
create table public.extension_linkedin_sends (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text not null references public.enriched_leads(id) on delete cascade,
  profile_url text not null,
  message text not null check (length(message) between 1 and 1200),
  claim_token uuid not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'uncertain', 'not_sent')),
  event_id text,
  thread_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'confirmed' or event_id is not null)
);
create index extension_linkedin_sends_lead_idx on public.extension_linkedin_sends(organization_id, lead_id, created_at desc);
alter table public.extension_linkedin_sends enable row level security;
-- Browser clients cannot forge another workspace's claim or mutate send history.
revoke all on public.extension_linkedin_sends from public, anon, authenticated;
grant select, insert, update, delete on public.extension_linkedin_sends to service_role;
