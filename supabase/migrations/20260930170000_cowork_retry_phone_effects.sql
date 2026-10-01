-- Two effects Cowork will be able to propose, each with its own approval: retrying the sends of a campaign
-- that failed for a reason that can be retried («campaign_retry») and revealing the phone of a saved contact
-- with the provider, at its cost («enrich_phone»). Neither needs a staging table: the approved target carries
-- a hash of exactly what the card listed, and the approval recomputes it from the database and refuses if it
-- changed. So this only teaches the two places that know the vocabulary of effects the two new kinds:
-- the check of the proposals table and the list inside cowork_propose_effect.
-- Forward-only and inert on its own: nothing proposes these effects until the app ships its halves, each
-- behind its own flag (off by default).
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch',
    'campaign_retry', 'enrich_phone'));

-- cowork_propose_effect must accept the same vocabulary as the table constraint. Its installed
-- definition is transformed instead of copied (as 20260930160000_cowork_batch_proposals.sql does): the
-- access policy, the contacts import and the batches extended it, and this keeps all of that exactly as
-- it is. The only change is the two new kinds in the list of known effects. «create or replace» keeps the
-- function's owner and privileges.
do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''linkedin_message_batch'') then', '''linkedin_message_batch'',''campaign_retry'',''enrich_phone'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
