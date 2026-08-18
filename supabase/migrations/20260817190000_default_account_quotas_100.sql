-- Account quotas are enforced by the server policy, independently from
-- per-mission automation budgets. Keep existing automation configuration
-- untouched and make new configuration rows default to 100 per resource.

alter table public.antonia_config add column if not exists daily_contact_limit integer;

alter table public.antonia_config
  alter column daily_search_limit set default 100,
  alter column daily_enrich_limit set default 100,
  alter column daily_investigate_limit set default 100,
  alter column daily_contact_limit set default 100;

notify pgrst, 'reload schema';
