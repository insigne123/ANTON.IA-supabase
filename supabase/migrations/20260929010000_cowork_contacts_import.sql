-- Cowork imports the contacts of a file the user uploaded (plan 2, F4). When the worker
-- proposes the import it stages it here: which column is which, the cleaned contacts and
-- what was left out. The approval card shows this row and the approved effect inserts
-- exactly these contacts. One import per run; the row goes away with its run. Like the
-- other staging tables, only the worker (service_role) reads or writes it.
create table public.cowork_contacts_import_proposals (
  run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 300),
  sheet text check (sheet is null or length(sheet) between 1 and 100),
  column_map jsonb not null check (jsonb_typeof(column_map) = 'object' and pg_column_size(column_map) <= 4096),
  contacts jsonb not null check (
    case when jsonb_typeof(contacts) = 'array' then jsonb_array_length(contacts) between 1 and 500 else false end
    and pg_column_size(contacts) <= 1048576),
  total_rows integer not null check (total_rows between 1 and 1000000),
  duplicates integer not null default 0 check (duplicates between 0 and 1000000),
  skipped integer not null default 0 check (skipped between 0 and 1000000),
  patch_hash text not null check (patch_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
alter table public.cowork_contacts_import_proposals enable row level security;
revoke all on public.cowork_contacts_import_proposals from anon, authenticated;
grant all on public.cowork_contacts_import_proposals to service_role;

alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import'));

-- The RPC must accept the same vocabulary as the table constraint. Same body as in
-- 20260922050000_cowork_linkedin_bridge.sql; only contacts_import is new.
create or replace function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind is null or p_kind not in ('save_contact','start_research','request_draft','enrich_contact',
    'send_email','campaign_create','campaign_activate','campaign_pause','code_execute',
    'profile_update','saved_search_create','saved_search_update','saved_search_delete',
    'campaign_stop_v2','crm_update_record','campaign_prepare_draft_v2',
    'crm_assign_lead','exception_resolve','mission_control','message_context_update',
    'enrich_batch','campaign_schedule_batch','linkedin_invite','linkedin_message',
    'contacts_import') then
    raise exception 'Unknown effect' using errcode='22023';
  end if;
  if p_target_id is null or length(trim(p_target_id)) = 0 or length(p_target_id) > 300 then raise exception 'Invalid target' using errcode='22023'; end if;
  if p_label is null or length(trim(p_label)) = 0 or length(p_label) > 280 then raise exception 'Invalid label' using errcode='22023'; end if;
  select * into r from public.cowork_runs where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if p_origin_run_id is null then raise exception 'Origin unavailable' using errcode='22023'; end if;
  if p_origin_run_id <> p_run_id then
    perform 1 from public.cowork_runs where id=p_origin_run_id and user_id=r.user_id and organization_id=r.organization_id and status='completed';
    if not found then raise exception 'Origin unavailable' using errcode='22023'; end if;
  end if;
  insert into public.cowork_effect_proposals(run_id,user_id,organization_id,kind,origin_run_id,target_id,label)
    values(r.id,r.user_id,r.organization_id,p_kind,p_origin_run_id,trim(p_target_id),trim(p_label));
  update public.cowork_runs set status='waiting_approval',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',
      jsonb_build_object('action','cowork.effect','kind',p_kind,'targetId',trim(p_target_id),'label',trim(p_label)));
  return true;
end; $$;
revoke all on function public.cowork_propose_effect(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cowork_propose_effect(uuid,uuid,text,uuid,text,text) to service_role;
