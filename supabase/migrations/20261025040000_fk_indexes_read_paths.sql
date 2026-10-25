-- DB-01, second part: indexes for foreign keys of Oportunidades and Cowork that the app also reads through. The Supabase linter
-- (0001 unindexed_foreign_keys) lists 107 there, most on proposal tables with a handful of rows; these are the ones on tables
-- with rows whose reads go by those columns:
-- - Administración → «Oportunidades y Cowork» reads an organization's runs and model calls between two dates (admin-work-data.ts);
-- - admitting an Oportunidades step adds up an organization's reservations of the period (opportunity_budget_reserve);
-- - the offer and the assistant read an opportunity's document passages within its organization (workspace-offer.ts);
-- - «Otra versión» and an edited message look for the turns of the same parent (previous-versions.ts).
-- The rest also make deleting an organization or a person cheap. The tables are small (at most 9,000 rows): each index builds in
-- milliseconds. Forward-only; nothing is dropped.

create index if not exists cowork_runs_org_created on public.cowork_runs (organization_id, created_at);
create index if not exists cowork_model_calls_org_created on public.cowork_model_calls (organization_id, created_at);
create index if not exists cowork_runs_parent_scope on public.cowork_runs (parent_run_id, user_id, organization_id);
create index if not exists opportunity_budget_reservations_org_period on public.opportunity_budget_reservations (organization_id, period);
create index if not exists opportunity_document_chunks_scope on public.opportunity_document_chunks (organization_id, opportunity_id, document_id);
create index if not exists opportunity_evaluations_org_opportunity on public.opportunity_evaluations (organization_id, opportunity_id);
create index if not exists opportunity_jobs_org_opportunity on public.opportunity_jobs (organization_id, opportunity_id);
create index if not exists opportunity_jobs_requested_by on public.opportunity_jobs (requested_by);
create index if not exists opportunity_ai_results_org on public.opportunity_ai_results (organization_id);
