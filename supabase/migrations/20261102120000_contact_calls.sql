-- «Llamar» y «WhatsApp» (2 Nov 2026, plan de uso y créditos U1). GrupoExpro spent 98% of October's Apollo credits on
-- mobiles and works by phone, but a call existed only as a task after a first email (contact_touches), so not one call
-- was ever recorded. One row per call or WhatsApp started from ANTON.IA, created when the person taps the button (the
-- page mints the id, so a retried request writes it once) and completed with its result when they come back.
-- The contact's name, company and email are kept as they were, so the history survives if the contact is removed from
-- «Por escribir». Read and written by the server only (src/lib/server/contact-calls.ts).
create table if not exists public.contact_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id text references public.enriched_leads(id) on delete set null,
  provider_person_id text check (provider_person_id is null or char_length(provider_person_id) <= 120),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  contact_company text check (contact_company is null or char_length(contact_company) <= 200),
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  channel text not null check (channel in ('call', 'whatsapp')),
  outcome text check (outcome is null or outcome in ('answered', 'meeting', 'no_answer', 'not_interested', 'wrong_number')),
  note text check (note is null or char_length(note) <= 1000),
  started_at timestamptz not null default now(),
  outcome_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_calls_outcome_time_check check ((outcome is null) = (outcome_at is null))
);

-- «Hoy» and the goals read one person's recent calls; «Por escribir» reads the last call of each contact.
create index if not exists contact_calls_org_user_started_idx on public.contact_calls (organization_id, user_id, started_at desc);
create index if not exists contact_calls_lead_idx on public.contact_calls (lead_id) where lead_id is not null;

alter table public.contact_calls enable row level security;
revoke all on table public.contact_calls from public, anon, authenticated;
grant select, insert, update, delete on table public.contact_calls to service_role;
