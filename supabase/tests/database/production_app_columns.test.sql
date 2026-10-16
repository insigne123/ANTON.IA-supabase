begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(10);

-- What the app reads exists in a database built from the repository, as in production.
select has_column('public', 'enriched_leads', 'organization_name', 'enriched_leads.organization_name');
select col_default_is('public', 'enriched_leads', 'contacted_count', '0', 'enriched_leads.contacted_count starts at 0');
select col_type_is('public', 'lead_research_reports', 'completed_at', 'timestamp with time zone', 'lead_research_reports.completed_at');
select col_type_is('public', 'contacted_leads', 'campaign_id', 'uuid', 'contacted_leads.campaign_id');
select has_column('public', 'contacted_leads', 'linkedin_thread_url', 'contacted_leads.linkedin_thread_url');
select col_type_is('public', 'contacted_leads', 'scheduled_at', 'timestamp with time zone', 'contacted_leads.scheduled_at');
select col_default_is('public', 'organizations', 'social_search_credits', '100', 'organizations.social_search_credits');
select col_default_is('public', 'organizations', 'feature_social_search_enabled', 'true', 'organizations.feature_social_search_enabled');

-- The session clients read these through RLS: the role needs the table privilege too.
select ok(has_table_privilege('authenticated', 'public.outbound_dispatches', 'select'), 'authenticated can select outbound_dispatches (RLS decides which rows)');
select ok(has_table_privilege('authenticated', 'public.lead_research_reports', 'select'), 'authenticated can select lead_research_reports (RLS decides which rows)');

select * from finish();
rollback;
