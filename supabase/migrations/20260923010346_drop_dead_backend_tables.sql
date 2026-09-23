-- Remote ledger: 20260923010346. Owner confirmed the SEO backend is dead.
-- Drops 16 orphan tables with no dependents outside the set (verified: no
-- external FKs, views, or non-backend functions reference them).
drop table if exists public.backend_contact_candidates, public.backend_contacts, public.backend_demo_feedback, public.backend_demos, public.backend_funnel_events, public.backend_jobs, public.backend_lead_handoff_briefs, public.backend_message_events, public.backend_messages, public.backend_outreach_suppressions, public.backend_place_snapshots, public.backend_places, public.backend_report_dispatches, public.backend_schema_migrations, public.backend_system_settings, public.backend_verifications;
