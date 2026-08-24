-- Canonical persistence for Apollo people-search results.
-- The production table was previously referenced by application code but was
-- not represented in the repository migrations.
create table if not exists public.people_search_leads (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  organization_id text,
  apollo_person_id text,
  name text,
  first_name text,
  last_name text,
  email text,
  email_status text,
  linkedin_url text,
  org_name text,
  organization_name text,
  organization_website text,
  industry text,
  title text,
  photo_url text,
  city text,
  state text,
  country text,
  headline text,
  seniority text,
  departments jsonb,
  phone_numbers jsonb,
  primary_phone text,
  enrichment_status text,
  organization_domain text,
  organization_industry text,
  organization_size integer,
  page integer,
  batch_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Some environments already have an older Apollo table. Add the fields used by
-- the current contract and relax legacy provider-required fields before writes.
alter table public.people_search_leads
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists apollo_person_id text;
alter table public.people_search_leads
  alter column linkedin_url drop not null,
  alter column batch_run_id drop not null;
create index if not exists people_search_leads_organization_idx
  on public.people_search_leads (organization_id);
create index if not exists people_search_leads_linkedin_idx
  on public.people_search_leads (linkedin_url);
create index if not exists people_search_leads_email_idx
  on public.people_search_leads (email);
create index if not exists people_search_leads_apollo_idx
  on public.people_search_leads (apollo_person_id);
alter table public.people_search_leads enable row level security;
drop policy if exists "Enable all access for all users" on public.people_search_leads;
revoke all on table public.people_search_leads from public, anon, authenticated;
grant all on table public.people_search_leads to service_role;
