-- The AI's draft of an offer (technical text by evaluation criterion, compliance, economic lines and cover letter), one row
-- per preparation, and the unit prices the team types on its economic lines. Read and written only through the server,
-- like the reports and the marks.
create table public.opportunity_offer_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  opportunity_id uuid not null,
  report_id uuid,
  job_id uuid references public.opportunity_jobs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  draft jsonb not null check (pg_column_size(draft) <= 524288),
  prices jsonb not null default '{}'::jsonb check (jsonb_typeof(prices) = 'object' and pg_column_size(prices) <= 65536),
  revision integer not null default 0 check (revision >= 0),
  prices_updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, opportunity_id) references public.commercial_opportunities(organization_id, id) on delete cascade
);
create index opportunity_offer_drafts_latest_idx on public.opportunity_offer_drafts (organization_id, opportunity_id, created_at desc);
-- A job saves its draft once, even when the worker retries the commit (several null job ids are allowed).
create unique index opportunity_offer_drafts_job_idx on public.opportunity_offer_drafts (job_id);

alter table public.opportunity_offer_drafts enable row level security;
revoke all on public.opportunity_offer_drafts from public, anon, authenticated;
grant all on public.opportunity_offer_drafts to service_role;

notify pgrst, 'reload schema';
