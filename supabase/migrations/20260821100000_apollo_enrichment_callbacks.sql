-- Opaque, single-purpose callback records for Apollo asynchronous enrichment.
create table if not exists public.apollo_enrichment_callbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_table text not null check (target_table in ('people_search_leads', 'enriched_leads')),
  target_lead_id text not null,
  apollo_person_id text not null,
  token_hash text not null,
  idempotency_key text not null,
  operation_id text not null,
  reveal_email boolean not null default true,
  reveal_phone boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'failed', 'processing', 'completed', 'no_phone', 'expired')),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  provider_queued_at timestamptz,
  provider_request_id text,
  payload_hash text,
  last_error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apollo_enrichment_callbacks_token_hash_key unique (token_hash),
  constraint apollo_enrichment_callbacks_idempotency_key_key unique (idempotency_key)
);
create index if not exists apollo_enrichment_callbacks_status_expiry_idx
  on public.apollo_enrichment_callbacks (status, expires_at);
create index if not exists apollo_enrichment_callbacks_target_idx
  on public.apollo_enrichment_callbacks (target_table, target_lead_id);
alter table public.apollo_enrichment_callbacks enable row level security;
-- Callback records are written and consumed only with the service role.
-- No client policy is intentionally exposed because the table stores ownership
-- and provider delivery metadata that is not part of the public lead contract.
revoke all on table public.apollo_enrichment_callbacks from anon, authenticated;
grant all on table public.apollo_enrichment_callbacks to service_role;
-- The local bootstrap does not always carry default table grants across legacy
-- migrations. Reassert the server-only access required by the backend setup.
grant select, insert, update, delete on table
  public.organizations,
  public.organization_members,
  public.leads,
  public.enriched_leads
to service_role;
