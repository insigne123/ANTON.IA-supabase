-- Remote migration ledger version: 20260921133043. Fase 4: tres efectos con
-- revisión humana (crm_assign_lead, exception_resolve, mission_control) y sus
-- propuestas preparadas. Solo amplía vocabulario y añade objetos nuevos; no
-- altera permisos existentes.
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control'));

-- The RPC must accept the same vocabulary as the table constraint.
create or replace function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind is null or p_kind not in ('save_contact','start_research','request_draft','enrich_contact',
    'send_email','campaign_create','campaign_activate','campaign_pause','code_execute',
    'profile_update','saved_search_create','saved_search_update','saved_search_delete',
    'campaign_stop_v2','crm_update_record','campaign_prepare_draft_v2',
    'crm_assign_lead','exception_resolve','mission_control') then
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

-- Cowork entry point to the v1 collaboration matrix with an explicit actor.
-- Mirrors assign/claim/release_organization_lead_v1 checks exactly; the only
-- difference is the actor comes from the reviewed proposal (service_role
-- caller) instead of auth.uid(). The worker guarantees the actor is the
-- Cowork owner with a live grant; this function re-verifies it.
create or replace function public.cowork_lead_collaboration_op(
  p_lead_id uuid, p_actor_user_id uuid, p_op text,
  p_assigned_to_user_id uuid default null, p_minutes integer default 15
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.organization_lead_collaboration%rowtype; v_role text;
begin
  if p_lead_id is null or p_actor_user_id is null
    or p_op is null or p_op not in ('assign','claim','release') then
    raise exception 'invalid collaboration operation' using errcode='22023'; end if;
  if p_op = 'assign' and p_assigned_to_user_id is null then
    raise exception 'invalid lead assignment' using errcode='22023'; end if;
  if p_op = 'claim' and (p_minutes is null or p_minutes not between 1 and 60) then
    raise exception 'invalid lead claim' using errcode='22023'; end if;
  select * into v_row from public.organization_lead_collaboration where lead_id=p_lead_id for update;
  if not found then raise exception 'Lead collaboration row not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.organizations o
    where o.id=v_row.organization_id and o.collaboration_v1_enabled) then
    raise exception 'Organization collaboration is not enabled' using errcode='55000'; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=p_actor_user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=v_row.organization_id) then raise exception 'Cowork access revoked' using errcode='42501'; end if;
  select om.role into v_role from public.organization_members om
    where om.organization_id=v_row.organization_id and om.user_id=p_actor_user_id;
  if v_role is null then raise exception 'not authorized' using errcode='42501'; end if;

  if p_op = 'assign' then
    if not exists(select 1 from public.organization_members om
      where om.organization_id=v_row.organization_id and om.user_id=p_assigned_to_user_id) then
      raise exception 'Assignee is not an organization member' using errcode='22023'; end if;
    if v_role = 'member' and (p_assigned_to_user_id <> p_actor_user_id
      or (v_row.assigned_to_user_id is not null and v_row.assigned_to_user_id <> p_actor_user_id)) then
      raise exception 'Members can only claim an unassigned lead for themselves' using errcode='42501'; end if;
    update public.organization_lead_collaboration
    set assigned_to_user_id=p_assigned_to_user_id, assigned_at=now(), assigned_by_user_id=p_actor_user_id,
      claimed_by_user_id=case when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id
        then null else claimed_by_user_id end,
      claim_expires_at=case when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id
        then null else claim_expires_at end,
      contact_state=case when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id
        and contact_state='reserved' then 'uncontacted' else contact_state end
    where lead_id=p_lead_id returning * into v_row;
    perform public.append_organization_collaboration_event_v1(
      v_row.organization_id, p_actor_user_id, 'lead.assigned', 'lead', p_lead_id::text,
      p_lead_id, null, jsonb_build_object('assignedToUserId', p_assigned_to_user_id));
    return to_jsonb(v_row);
  end if;

  if p_op = 'claim' then
    if v_row.claimed_by_user_id is not null and v_row.claimed_by_user_id <> p_actor_user_id
      and v_row.claim_expires_at > now() then
      raise exception 'Lead is already being prepared by another member' using errcode='55000'; end if;
    if v_role = 'member' and v_row.assigned_to_user_id is not null
      and v_row.assigned_to_user_id <> p_actor_user_id then
      raise exception 'Lead is assigned to another member' using errcode='42501'; end if;
    update public.organization_lead_collaboration
    set assigned_to_user_id=coalesce(assigned_to_user_id, p_actor_user_id),
      assigned_at=case when assigned_to_user_id is null then now() else assigned_at end,
      assigned_by_user_id=case when assigned_to_user_id is null then p_actor_user_id else assigned_by_user_id end,
      claimed_by_user_id=p_actor_user_id,
      claim_expires_at=now()+make_interval(mins=>p_minutes),
      contact_state=case when contact_state='uncontacted' then 'reserved' else contact_state end
    where lead_id=p_lead_id returning * into v_row;
    perform public.append_organization_collaboration_event_v1(
      v_row.organization_id, p_actor_user_id, 'lead.claimed', 'lead', p_lead_id::text,
      p_lead_id, null, jsonb_build_object('expiresAt', v_row.claim_expires_at));
    return to_jsonb(v_row);
  end if;

  if v_role is null or (v_row.claimed_by_user_id is distinct from p_actor_user_id
    and v_role not in ('owner','admin')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  update public.organization_lead_collaboration
  set claimed_by_user_id=null, claim_expires_at=null,
    contact_state=case when contact_state='reserved' then 'uncontacted' else contact_state end
  where lead_id=p_lead_id;
  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, p_actor_user_id, 'lead.claim_released', 'lead', p_lead_id::text,
    p_lead_id, null, '{}'::jsonb);
  return jsonb_build_object('released', true);
end; $$;
revoke all on function public.cowork_lead_collaboration_op(uuid,uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.cowork_lead_collaboration_op(uuid,uuid,text,uuid,integer) to service_role;

-- Staged collaboration change reviewed by the owner. op is assign, claim or
-- release; base pins the row version seen at review. Execution calls the
-- wrapper above, which re-validates the whole v1 matrix atomically.
create table public.cowork_crm_assign_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  op text not null check (op in ('assign','claim','release')),
  assigned_to_user_id uuid,
  minutes integer,
  base_updated_at timestamptz not null,
  proposal_hash text not null check (length(proposal_hash) = 64),
  created_at timestamptz not null default now()
);
alter table public.cowork_crm_assign_proposals enable row level security;
revoke all on public.cowork_crm_assign_proposals from anon, authenticated;
grant select on public.cowork_crm_assign_proposals to authenticated;
grant all on public.cowork_crm_assign_proposals to service_role;
create policy cowork_crm_assign_proposals_private on public.cowork_crm_assign_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

-- Staged exception triage reviewed by the owner. Only open exceptions may
-- move to resolved or dismissed, with a mandatory reason. Execution
-- re-checks the open state and version; the reason is stored in payload.
create table public.cowork_exception_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  exception_id uuid not null,
  action text not null check (action in ('resolved','dismissed')),
  reason text not null check (length(reason) between 3 and 500),
  base_updated_at timestamptz not null,
  proposal_hash text not null check (length(proposal_hash) = 64),
  created_at timestamptz not null default now()
);
alter table public.cowork_exception_proposals enable row level security;
revoke all on public.cowork_exception_proposals from anon, authenticated;
grant select on public.cowork_exception_proposals to authenticated;
grant all on public.cowork_exception_proposals to service_role;
create policy cowork_exception_proposals_private on public.cowork_exception_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

-- Staged mission control reviewed by the owner. Only the owner's own
-- missions (user_id) may pause or resume. Execution re-checks the state and
-- version; pausing completes pending prospecting/contact tasks and logs the
-- manual pause, mirroring the app's own transition.
create table public.cowork_mission_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mission_id uuid not null,
  target_status text not null check (target_status in ('paused','active')),
  base_status text not null,
  base_updated_at timestamptz not null,
  proposal_hash text not null check (length(proposal_hash) = 64),
  created_at timestamptz not null default now()
);
alter table public.cowork_mission_proposals enable row level security;
revoke all on public.cowork_mission_proposals from anon, authenticated;
grant select on public.cowork_mission_proposals to authenticated;
grant all on public.cowork_mission_proposals to service_role;
create policy cowork_mission_proposals_private on public.cowork_mission_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));
