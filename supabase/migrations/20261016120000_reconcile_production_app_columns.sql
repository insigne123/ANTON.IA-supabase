-- Production already has these columns and grants; no migration in this repository created them, so a database built
-- from the repository broke what reads them («Recomendados para ti» in Hoy, the first-send check in Hoy, LinkedIn reply
-- threads, social search credits). Types and defaults are production's, read from its schema (16 Oct 2026).
-- Additive and idempotent: in production every statement is a no-op.

alter table public.enriched_leads add column if not exists organization_name text;
alter table public.enriched_leads add column if not exists contacted_count integer default 0;

alter table public.lead_research_reports add column if not exists completed_at timestamptz;

alter table public.contacted_leads add column if not exists campaign_id uuid;
alter table public.contacted_leads add column if not exists linkedin_thread_url text;
alter table public.contacted_leads add column if not exists scheduled_at timestamptz;

alter table public.organizations add column if not exists social_search_credits integer default 100;
alter table public.organizations add column if not exists feature_social_search_enabled boolean default true;

-- PostgREST needs table privileges in addition to RLS (20260821120000_grant_authenticated_app_tables.sql). Both tables
-- already have their select policy for the people they belong to; the session clients of Hoy and of the recommendations read them.
grant select on public.outbound_dispatches to authenticated;
grant select on public.lead_research_reports to authenticated;
