-- DB-01: the read policies of Cowork and the old «opportunities» compared auth.uid() with each row, so Postgres called it once
-- per row. Inside a select it is read once per query (Supabase linter 0003, auth_rls_initplan). Same meaning, same roles and
-- commands: only how often auth.uid() runs changes. Forward-only; the policies stay in place, so nothing is open in between.

-- Cowork: each person reads only their own rows, while they have Cowork in that organization.
alter policy cowork_campaign_definitions_private on public.cowork_campaign_definitions
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_campaign_prepare_proposals_private on public.cowork_campaign_prepare_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_code_proposals_private on public.cowork_code_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_crm_assign_proposals_private on public.cowork_crm_assign_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_crm_record_proposals_private on public.cowork_crm_record_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_document_versions_private on public.cowork_document_versions
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_documents_private on public.cowork_documents
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_draft_private_read on public.cowork_draft_requests
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_effect_proposals_private on public.cowork_effect_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_exception_proposals_private on public.cowork_exception_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_mission_proposals_private on public.cowork_mission_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_model_calls_private on public.cowork_model_calls
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_note_private_read on public.cowork_note_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_operations_private on public.cowork_operations
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_profile_proposals_private on public.cowork_profile_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_drafts_private_read on public.cowork_run_drafts
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_events_private_read on public.cowork_run_events
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_runs_private_read on public.cowork_runs
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_saved_search_proposals_private on public.cowork_saved_search_proposals
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_scheduled_tasks_private_read on public.cowork_scheduled_tasks
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_specialist_private on public.cowork_specialist_tasks
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));
alter policy cowork_thread_settings_private_read on public.cowork_thread_settings
  using ((user_id = (select auth.uid())) and public.cowork_has_access(organization_id));

-- The old «opportunities» table: each person, their own.
alter policy "Users can view their own opportunities" on public.opportunities using ((select auth.uid()) = user_id);
alter policy "Users can update their own opportunities" on public.opportunities using ((select auth.uid()) = user_id);
alter policy "Users can delete their own opportunities" on public.opportunities using ((select auth.uid()) = user_id);
alter policy "Users can insert their own opportunities" on public.opportunities with check ((select auth.uid()) = user_id);
