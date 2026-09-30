-- Cowork answers someone who wrote, inside the original thread («responder dentro del hilo»).
-- When the worker proposes the reply it stages here exactly what the approval card shows: to
-- whom, the subject and the body. The approved effect sends that text in the thread of that
-- conversation; if the text or the conversation changed after the proposal, the hash no longer
-- matches and nothing is sent. One reply per run; the row goes away with its run or with the
-- conversation. Like the other staging tables, only the worker (service_role) reads or writes it.
-- Forward-only and inert on its own: nothing proposes this effect until the app ships its half.
create table public.cowork_reply_proposals (
  run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  contacted_id text not null references public.contacted_leads(id) on delete cascade,
  to_email text not null check (length(to_email) between 3 and 320 and position('@' in to_email) > 1),
  subject text not null check (length(trim(subject)) between 1 and 300),
  body text not null check (length(trim(body)) between 1 and 8000),
  patch_hash text not null check (patch_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
create index cowork_reply_proposals_contacted_idx on public.cowork_reply_proposals(contacted_id);
alter table public.cowork_reply_proposals enable row level security;
revoke all on public.cowork_reply_proposals from public, anon, authenticated;
grant all on public.cowork_reply_proposals to service_role;

alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread'));

-- cowork_propose_effect must accept the same vocabulary as the table constraint. Its installed
-- definition is transformed instead of copied (as 20260930020000_cowork_access_policy.sql does):
-- M3 extended it and M5 replaced its access expression, and this keeps both exactly as they are.
-- The only change is the new kind in the list of known effects. «create or replace» keeps the
-- function's owner and privileges.
do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''contacts_import'') then', '''contacts_import'',''reply_thread'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
