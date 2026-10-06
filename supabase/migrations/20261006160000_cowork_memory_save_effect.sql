-- Plan 12 (5): Cowork can propose remembering a preference the person asked it to keep («recuerda que no le escribo a…»,
-- «de ahora en adelante, tono cercano»). The memory is staged in suplia_memories as «proposed», which no turn reads; approving
-- the card turns it «approved», and every turn already reads the approved ones (server/cowork/user-context.ts). So the only
-- change here is the new kind, «memory_save», in the two places that know the vocabulary of effects: the check of the
-- proposals table and the list inside cowork_propose_effect.
-- Forward-only and inert on its own: nothing proposes this effect until the app ships its half, behind
-- COWORK_PREFERENCES_ENABLED (off by default).
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch',
    'campaign_retry', 'enrich_phone', 'lead_prepare_batch', 'memory_save'));

-- cowork_propose_effect must accept the same vocabulary as the table constraint. Its installed definition is transformed
-- instead of copied (as 20261001210000_cowork_prepare_batch.sql does), so everything earlier migrations added stays exactly
-- as it is. «create or replace» keeps the function's owner and privileges.
do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''lead_prepare_batch'') then', '''lead_prepare_batch'',''memory_save'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
