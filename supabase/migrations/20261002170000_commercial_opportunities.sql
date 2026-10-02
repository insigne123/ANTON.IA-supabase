-- Plan 8, phase 3: commercial opportunities, first for the GrupoExpro pilot. Three kinds of signal, kept per organization:
-- companies that are hiring (job ads grouped by company), public tenders (Mercado Público and Compra Ágil) and SEIA projects,
-- scored against the offer of a search profile. Only the server reads and writes them, after checking
-- OPPORTUNITIES_ALLOWED_EMAILS: members get no grant, so the section stays visible to the pilot account alone. Data about
-- companies only: the people in a job ad are not stored. The older `opportunities` and `enriched_opportunities` tables of
-- the previous section are not touched.

-- What to look for: the offer and the filters of each source.
create table if not exists public.commercial_opportunity_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  offer text not null default '',
  roles text[] not null default '{}',
  regions text[] not null default '{}',
  min_ads integer not null default 5,
  keywords text[] not null default '{}',
  unspsc_codes text[] not null default '{}',
  seia_sectors text[] not null default '{}',
  min_investment_usd numeric,
  sources text[] not null default '{hiring}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_opportunity_profiles_name_check check (length(trim(name)) between 1 and 120),
  constraint commercial_opportunity_profiles_offer_check check (length(offer) <= 2000),
  constraint commercial_opportunity_profiles_min_ads_check check (min_ads between 1 and 100),
  constraint commercial_opportunity_profiles_lists_check check (
    cardinality(roles) <= 40 and cardinality(regions) <= 20 and cardinality(keywords) <= 40
    and cardinality(unspsc_codes) <= 40 and cardinality(seia_sectors) <= 20
  ),
  constraint commercial_opportunity_profiles_sources_check check (
    cardinality(sources) between 1 and 4 and sources <@ array['hiring', 'tender', 'compra_agil', 'project']::text[]
  ),
  constraint commercial_opportunity_profiles_investment_check check (min_investment_usd is null or min_investment_usd >= 0)
);
create unique index if not exists commercial_opportunity_profiles_name_idx
  on public.commercial_opportunity_profiles(organization_id, lower(name));

-- One row per company that is hiring, tender or project, with its score and where the person left it.
create table if not exists public.commercial_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.commercial_opportunity_profiles(id) on delete set null,
  kind text not null,
  dedupe_key text not null,
  title text not null,
  company_name text,
  company_domain text,
  company_linkedin_url text,
  buyer_name text,
  region text,
  amount numeric,
  currency text,
  deadline_at timestamptz,
  published_at timestamptz,
  url text,
  score integer not null default 0,
  reasons text[] not null default '{}',
  status text not null default 'new',
  claimed_by uuid references auth.users(id) on delete set null,
  signal_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_opportunities_kind_check check (kind in ('hiring', 'tender', 'compra_agil', 'project')),
  constraint commercial_opportunities_dedupe_key_check check (length(dedupe_key) between 1 and 300),
  constraint commercial_opportunities_title_check check (length(trim(title)) between 1 and 500),
  constraint commercial_opportunities_text_check check (
    coalesce(length(company_name), 0) <= 300 and coalesce(length(company_domain), 0) <= 253
    and coalesce(length(company_linkedin_url), 0) <= 500 and coalesce(length(buyer_name), 0) <= 300
    and coalesce(length(region), 0) <= 120 and coalesce(length(currency), 0) <= 8
  ),
  constraint commercial_opportunities_url_check check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  constraint commercial_opportunities_amount_check check (amount is null or amount >= 0),
  constraint commercial_opportunities_score_check check (score between 0 and 100),
  constraint commercial_opportunities_reasons_check check (cardinality(reasons) <= 10),
  constraint commercial_opportunities_status_check check (status in ('new', 'interested', 'dismissed', 'converted')),
  constraint commercial_opportunities_signal_count_check check (signal_count >= 0),
  constraint commercial_opportunities_data_check check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384)
);
create unique index if not exists commercial_opportunities_dedupe_idx
  on public.commercial_opportunities(organization_id, kind, dedupe_key);
create index if not exists commercial_opportunities_list_idx
  on public.commercial_opportunities(organization_id, kind, status, score desc, last_seen_at desc);

-- The evidence of each one: a job ad, a tender or a project, as the source published it (trimmed, without people).
create table if not exists public.commercial_opportunity_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null references public.commercial_opportunities(id) on delete cascade,
  source text not null,
  external_id text not null,
  title text not null,
  location text,
  publisher text,
  url text,
  posted_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint commercial_opportunity_signals_source_check check (
    source in ('jsearch', 'linkedin', 'jooble', 'mercado_publico', 'compra_agil', 'seia')
  ),
  constraint commercial_opportunity_signals_external_id_check check (length(external_id) between 1 and 300),
  constraint commercial_opportunity_signals_title_check check (length(trim(title)) between 1 and 500),
  constraint commercial_opportunity_signals_text_check check (
    coalesce(length(location), 0) <= 200 and coalesce(length(publisher), 0) <= 120
  ),
  constraint commercial_opportunity_signals_url_check check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  constraint commercial_opportunity_signals_data_check check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 8192)
);
create unique index if not exists commercial_opportunity_signals_source_idx
  on public.commercial_opportunity_signals(organization_id, source, external_id);
create index if not exists commercial_opportunity_signals_opportunity_idx
  on public.commercial_opportunity_signals(opportunity_id, posted_at desc);

-- Each search or sync, with what it brought and what it cost: the monthly cap is read from here.
create table if not exists public.commercial_opportunity_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.commercial_opportunity_profiles(id) on delete set null,
  source text not null,
  trigger text not null default 'manual',
  status text not null default 'running',
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  fetched integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  cost_estimate_usd numeric(10, 4) not null default 0,
  error text,
  constraint commercial_opportunity_runs_source_check check (
    source in ('jsearch', 'linkedin', 'jooble', 'mercado_publico', 'compra_agil', 'seia')
  ),
  constraint commercial_opportunity_runs_trigger_check check (trigger in ('manual', 'schedule', 'upload')),
  constraint commercial_opportunity_runs_status_check check (status in ('running', 'succeeded', 'failed', 'skipped')),
  constraint commercial_opportunity_runs_finished_check check ((status = 'running') = (finished_at is null)),
  constraint commercial_opportunity_runs_counts_check check (fetched >= 0 and created >= 0 and updated >= 0 and cost_estimate_usd >= 0),
  constraint commercial_opportunity_runs_error_check check (error is null or length(error) <= 1000)
);
create index if not exists commercial_opportunity_runs_org_idx
  on public.commercial_opportunity_runs(organization_id, source, started_at desc);

alter table public.commercial_opportunity_profiles enable row level security;
alter table public.commercial_opportunities enable row level security;
alter table public.commercial_opportunity_signals enable row level security;
alter table public.commercial_opportunity_runs enable row level security;

revoke all on table public.commercial_opportunity_profiles from public, anon, authenticated;
revoke all on table public.commercial_opportunities from public, anon, authenticated;
revoke all on table public.commercial_opportunity_signals from public, anon, authenticated;
revoke all on table public.commercial_opportunity_runs from public, anon, authenticated;
grant all on table public.commercial_opportunity_profiles to service_role;
grant all on table public.commercial_opportunities to service_role;
grant all on table public.commercial_opportunity_signals to service_role;
grant all on table public.commercial_opportunity_runs to service_role;

notify pgrst, 'reload schema';
