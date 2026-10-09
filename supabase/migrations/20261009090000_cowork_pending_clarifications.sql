-- A question preserves its own pending proposal and its thread. No approval or effect is performed here.
create or replace function public.cowork_admit_clarification(
  p_user_id uuid, p_organization_id uuid, p_request_id uuid, p_message text, p_parent_run_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare parent public.cowork_runs; child_id uuid; existing public.cowork_runs;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || p_organization_id::text || p_request_id::text, 0));
  select * into parent from public.cowork_runs where id=p_parent_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then raise exception 'Parent unavailable' using errcode='22023'; end if;
  select * into existing from public.cowork_runs where user_id=p_user_id and organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if existing.parent_run_id is distinct from p_parent_run_id then raise exception 'Idempotency conflict' using errcode='22023'; end if;
    -- Reuse the normal admission gate, including on retries after the parent was resolved.
    return public.cowork_admit_run(p_user_id,p_organization_id,p_request_id,p_message,'approval');
  end if;
  if parent.status <> 'waiting_approval' or not exists(select 1 from public.cowork_run_events where run_id=parent.id and kind='approval.requested')
    or exists(select 1 from public.cowork_run_events where run_id=parent.id and kind in ('effect.approved','effect.started','search.approved','search.started')) then
    raise exception 'Proposal is not pending' using errcode='22023';
  end if;
  child_id := public.cowork_admit_run(p_user_id,p_organization_id,p_request_id,p_message,'approval');
  update public.cowork_runs set parent_run_id=parent.id,depth=0 where id=child_id;
  -- The existing parent/root trigger preserves the canonical conversation root.
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(child_id,p_user_id,p_organization_id,'clarification.requested',jsonb_build_object('parentRunId',parent.id,'effectsAllowed',false));
  return child_id;
end;
$$;
revoke all on function public.cowork_admit_clarification(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cowork_admit_clarification(uuid,uuid,uuid,text,uuid) to service_role;
