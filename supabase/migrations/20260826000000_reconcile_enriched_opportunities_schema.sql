-- Reconcile columns present in the production contract but absent from the
-- historical CLI migration chain. This is safe to apply after a clean replay.

alter table public.enriched_opportunities
  add column if not exists email_status text,
  add column if not exists contacted_count integer default 0;

alter table public.enriched_opportunities
  alter column contacted_count set default 0;

notify pgrst, 'reload schema';
