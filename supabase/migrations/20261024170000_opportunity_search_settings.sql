-- «Qué buscamos» (OPP-51): the sources the daily search runs (tenders, Compra Ágil, LinkedIn posts, job ads, and how often the job ads)
-- and the administrator's own rules for tenders (amount range, buyers to avoid; buyers, regions and UNSPSC codes the AI weighs), kept
-- beside the offer and apart from the criteria the AI derives from it: a new offer resets the criteria, never these. The app reads it
-- leniently (lib/commercial-opportunities/search-settings.ts): {} is every source every day and no rule, as before.
alter table public.opportunity_company_context add column if not exists search jsonb not null default '{}'::jsonb
  constraint opportunity_company_context_search_check check (jsonb_typeof(search) = 'object' and pg_column_size(search) <= 16384);
notify pgrst, 'reload schema';
