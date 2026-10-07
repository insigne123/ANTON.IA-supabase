-- Plan 13 (4c, tareas largas): Cowork can propose a plan for a request of several steps («busca 25 gerentes, guarda los 10
-- mejores, búscales el correo y escríbeles una secuencia»). The person approves the plan once: its steps, how much it may spend
-- (searches and credits) and what it never does without asking. The plan is staged as an event of the run that proposed it, so
-- the only change here is the new kind, «task_plan», in the two places that know the vocabulary of effects: the check of the
-- proposals table and the list inside cowork_propose_effect.
-- Forward-only and inert on its own: nothing proposes this effect until the app ships its half, behind COWORK_TASKS_ENABLED
-- (off by default).
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch',
    'campaign_retry', 'enrich_phone', 'lead_prepare_batch', 'memory_save', 'task_plan'));

-- cowork_propose_effect must accept the same vocabulary as the table constraint. Its installed definition is transformed
-- instead of copied (as 20261006160000_cowork_memory_save_effect.sql does), so everything earlier migrations added stays
-- exactly as it is. «create or replace» keeps the function's owner and privileges.
do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''memory_save'') then', '''memory_save'',''task_plan'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
