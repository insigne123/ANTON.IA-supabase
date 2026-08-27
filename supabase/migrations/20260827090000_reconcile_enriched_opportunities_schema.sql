-- Keep clean replays aligned with the deployed enriched-opportunities contract.
alter table public.enriched_opportunities
  add column if not exists email_status text,
  add column if not exists contacted_count integer default 0;

alter table public.enriched_opportunities
  alter column contacted_count set default 0;

notify pgrst, 'reload schema';
