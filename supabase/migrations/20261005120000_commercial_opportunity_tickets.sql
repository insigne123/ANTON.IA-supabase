-- Plan 10: each person brings their own Mercado Público ticket. Licitaciones and Compra Ágil read the public API with a
-- free personal ticket (10.000 requests a day), so the search no longer depends on one shared ticket. The ticket is a
-- credential: only the server reads and writes it, encrypted with token-crypto (enc:v1), and the browser only ever sees
-- the last four characters and when it was verified. Same pattern as provider_tokens.
create table if not exists public.commercial_opportunity_tickets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ticket_encrypted text not null,
  ticket_hint text,
  verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Never the ticket in clear: only the encrypted envelope written by encryptStoredToken.
  constraint commercial_opportunity_tickets_encrypted_check check (
    ticket_encrypted like 'enc:v1.%' and length(ticket_encrypted) <= 500
  ),
  constraint commercial_opportunity_tickets_hint_check check (ticket_hint is null or ticket_hint ~ '^[A-Za-z0-9]{1,4}$'),
  constraint commercial_opportunity_tickets_error_check check (last_error is null or length(last_error) <= 300)
);

alter table public.commercial_opportunity_tickets enable row level security;
revoke all on table public.commercial_opportunity_tickets from public, anon, authenticated;
grant all on table public.commercial_opportunity_tickets to service_role;
