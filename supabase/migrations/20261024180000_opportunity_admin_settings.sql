-- What the administrators decide for the whole workspace besides the offer and the search (OPP-06, OPP-10): the assignment rules
-- («Seguridad → Diego», with an optional minimum amount) that turn assigning the recommended ones into a confirmation, and the searches
-- of the list the team keeps, with who wants to hear of what is new in each. Kept beside the offer, written only by the workspace route
-- (service role, after its admin check), read leniently by the app (lib/commercial-opportunities/admin-settings.ts): {} is no rule and
-- no saved search, as before.
alter table public.opportunity_company_context add column if not exists admin_settings jsonb not null default '{}'::jsonb
  constraint opportunity_company_context_admin_settings_check check (jsonb_typeof(admin_settings) = 'object' and pg_column_size(admin_settings) <= 32768);
notify pgrst, 'reload schema';
