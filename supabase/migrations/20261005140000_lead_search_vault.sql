-- Plan 11 (PR 6b): Apify «Leads Finder» returns each person already enriched (name, email, phone, LinkedIn), but the search
-- must look like Apollo's until the person pays the enrichment. What the search brought waits here, encrypted with
-- token-crypto (enc:v1): only the server reads and writes it, the browser never sees it, and «Enriquecer» takes it from
-- here instead of asking again. It expires after 30 days; the app deletes expired rows of the organization when it writes
-- new ones. Same access pattern as provider_tokens and commercial_opportunity_tickets.
create table if not exists public.lead_search_vault (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  provider_lead_id text not null,
  searched_by uuid references auth.users(id) on delete set null,
  contact_encrypted text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  primary key (organization_id, provider, provider_lead_id),
  constraint lead_search_vault_provider_check check (provider in ('leads_finder')),
  -- The opaque id the search shows (lf_ + 24 hex), never an email or a LinkedIn address.
  constraint lead_search_vault_id_check check (provider_lead_id ~ '^lf_[0-9a-f]{24}$'),
  -- Never the contact in clear: only the encrypted envelope written by encryptStoredToken.
  constraint lead_search_vault_encrypted_check check (contact_encrypted like 'enc:v1.%' and length(contact_encrypted) <= 8000),
  constraint lead_search_vault_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '31 days')
);

create index if not exists lead_search_vault_expires_idx on public.lead_search_vault (organization_id, expires_at);

alter table public.lead_search_vault enable row level security;
revoke all on table public.lead_search_vault from public, anon, authenticated;
grant all on table public.lead_search_vault to service_role;
