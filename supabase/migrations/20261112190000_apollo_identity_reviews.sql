-- A LinkedIn profile search whose answer Apollo gave for another LinkedIn address (12 Nov 2026, docs/busqueda-de-leads.md): 14 of them
-- in 30 days, most with Apollo «high» about it, often the same person after changing their address. The match was refused and nothing was
-- shown, though Apollo had already charged it. The person who searched now sees whom Apollo found (name, title, company, photo, its
-- LinkedIn address) and what the AI makes of it, and decides: «Es la misma persona» shows the contact already paid for, «No es» forgets it.
--
-- One row per refused match, for 7 days. `candidate` holds only what a search result shows (no email or phone); the contact Apollo gave
-- waits encrypted (token-crypto, «enc:v1.») and is cleared once decided. Read and written by the server only, always for the person who
-- searched (src/lib/server/identity-reviews.ts).
create table if not exists public.apollo_identity_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_linkedin_url text not null check (char_length(requested_linkedin_url) between 10 and 500),
  candidate jsonb not null check (jsonb_typeof(candidate) = 'object' and octet_length(candidate::text) <= 8000),
  contact_encrypted text check (contact_encrypted is null or (contact_encrypted like 'enc:v1.%' and length(contact_encrypted) <= 8000)),
  reason text check (reason is null or char_length(reason) <= 80),
  verdict jsonb check (verdict is null or (jsonb_typeof(verdict) = 'object' and octet_length(verdict::text) <= 4000)),
  decision text check (decision is null or decision in ('same', 'different')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint apollo_identity_reviews_decided_check check ((decision is null) = (decided_at is null)),
  constraint apollo_identity_reviews_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '8 days')
);

create index if not exists apollo_identity_reviews_owner_idx on public.apollo_identity_reviews (organization_id, user_id, created_at desc);

alter table public.apollo_identity_reviews enable row level security;
revoke all on table public.apollo_identity_reviews from public, anon, authenticated;
grant select, insert, update, delete on table public.apollo_identity_reviews to service_role;
