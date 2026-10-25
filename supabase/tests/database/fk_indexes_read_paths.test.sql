begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

-- DB-01: the foreign keys the app reads through have an index that starts with their columns.
select has_index('public', 'cowork_runs', 'cowork_runs_org_created', array['organization_id', 'created_at'], 'an organization''s Cowork runs between two dates');
select has_index('public', 'cowork_model_calls', 'cowork_model_calls_org_created', array['organization_id', 'created_at'], 'an organization''s model calls between two dates');
select has_index('public', 'cowork_runs', 'cowork_runs_parent_scope', array['parent_run_id', 'user_id', 'organization_id'], 'the versions of a turn');
select has_index('public', 'opportunity_budget_reservations', 'opportunity_budget_reservations_org_period', array['organization_id', 'period'], 'an organization''s budget of the period');
select has_index('public', 'opportunity_document_chunks', 'opportunity_document_chunks_scope', array['organization_id', 'opportunity_id', 'document_id'], 'an opportunity''s document passages');
select has_index('public', 'opportunity_evaluations', 'opportunity_evaluations_org_opportunity', array['organization_id', 'opportunity_id'], 'an opportunity''s evaluations');
select has_index('public', 'opportunity_jobs', 'opportunity_jobs_org_opportunity', array['organization_id', 'opportunity_id'], 'an opportunity''s jobs');
select has_index('public', 'opportunity_jobs', 'opportunity_jobs_requested_by', array['requested_by'], 'the jobs a person asked for');
select has_index('public', 'opportunity_ai_results', 'opportunity_ai_results_org', array['organization_id'], 'an organization''s AI results');

select * from finish();
rollback;
