-- The historical privacy function returns report_id while older local schema
-- variants used a UUID id. Keep both identifiers available during replay.

alter table public.lead_research_reports
  add column if not exists report_id text generated always as (id::text) stored;

create unique index if not exists lead_research_reports_report_id_idx
  on public.lead_research_reports(report_id);

notify pgrst, 'reload schema';
