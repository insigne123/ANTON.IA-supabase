-- «Preparar contactos» (docs/cowork-preparar-contactos.md): several people of a conversation saved, with their email looked up
-- and researched, approved with one decision instead of one card per person and step. It reuses the staging table of the batches
-- (cowork_batch_proposals): the card lists each person with only what is still missing for them, and the person can take people
-- off before approving; the approved effect runs person by person. The rows keep the shape the table's guard already checks (one
-- uuid per person, each once, no message, staged with everyone in it), so this only teaches the new kind to the three places that
-- know the vocabulary: the staging table, the proposals table and the list inside cowork_propose_effect.
-- Forward-only and inert on its own: nothing proposes this effect until the app ships its half.
alter table public.cowork_batch_proposals drop constraint cowork_batch_proposals_kind_check;
alter table public.cowork_batch_proposals add constraint cowork_batch_proposals_kind_check
  check (kind in ('linkedin_invite_batch', 'linkedin_message_batch', 'lead_prepare_batch'));

alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch',
    'campaign_retry', 'enrich_phone', 'lead_prepare_batch'));

-- cowork_propose_effect must accept the same vocabulary as the table constraint. Its installed definition is transformed
-- instead of copied (as 20260930170000_cowork_retry_phone_effects.sql does), so everything earlier migrations added to it
-- stays exactly as it is. The only change is the new kind in the list of known effects. «create or replace» keeps the
-- function's owner and privileges.
do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''enrich_phone'') then', '''enrich_phone'',''lead_prepare_batch'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
