-- Applied as 20260920161555 via production MCP; legacy callers retain their contract.
-- Enable COWORK_OPERATION_LEASES_ENABLED only after schema/permissions checks.
alter table public.cowork_operations
  add column operation_expires_at timestamptz,
  add column run_attempt_token uuid;

create function public.cowork_reserve_operation_v2(
  p_user_id uuid, p_organization_id uuid, p_run_id uuid,
  p_capability text, p_version integer, p_input jsonb, p_input_hash text,
  p_lease uuid, p_run_lease uuid
) returns public.cowork_operations
language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; op public.cowork_operations; retryable boolean;
begin
  select * into r from public.cowork_runs where id=p_run_id for update;
  if not found or r.user_id<>p_user_id or r.organization_id<>p_organization_id
    or r.status<>'running' or r.lease_token is distinct from p_run_lease
    or p_run_lease is null or r.lease_expires_at is null or r.lease_expires_at<=now() then
    raise exception 'Run attempt unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.cowork_access_grants g
    join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled
      and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
      and m.organization_id=p_organization_id) then
    raise exception 'Access revoked' using errcode='42501';
  end if;
  if p_lease is null or p_input_hash is null or length(p_input_hash)<>64 then
    raise exception 'Invalid reservation' using errcode='22023';
  end if;
  insert into public.cowork_operations(user_id,organization_id,run_id,capability,version,
    input,input_hash,lease_token,status,attempts,operation_expires_at,run_attempt_token)
    values(p_user_id,p_organization_id,p_run_id,p_capability,p_version,
      coalesce(p_input,'null'::jsonb),p_input_hash,p_lease,'executing',1,
      least(now()+interval '120 seconds',r.lease_expires_at),p_run_lease)
    on conflict(user_id,organization_id,capability,version,input_hash) do nothing;
  select * into op from public.cowork_operations
    where user_id=p_user_id and organization_id=p_organization_id
      and capability=p_capability and version=p_version and input_hash=p_input_hash for update;
  if op.run_id<>p_run_id or op.input is distinct from coalesce(p_input,'null'::jsonb) then
    raise exception 'Reservation conflict' using errcode='22023';
  end if;
  if op.status in ('completed','failed','cancelled') then return op; end if;
  if op.operation_expires_at is null then
    -- A pre-v2 reservation has no trustworthy deadline. Never steal it.
    raise exception 'Legacy reservation unavailable' using errcode='55000';
  end if;
  if op.operation_expires_at>now() and op.run_attempt_token=p_run_lease then return op; end if;
  -- Only reads with no provider cost, and the immutable local plan, can retry.
  -- Generated specialist results are uncertain after interruption: no rebilling.
  retryable := p_capability in ('leads.search','leads.get','research.get_existing',
    'crm.search','crm.get_lead','contacted.search','contacted.timeline','metrics.overview',
    'app.context','draft.get','campaigns.list','files.list','saved_searches.list','specialists.plan');
  if not retryable or op.attempts>=3 then
    update public.cowork_operations set status='failed',
      error_code=case when retryable then 'attempts_exhausted' else 'outcome_unknown' end,
      updated_at=now() where id=op.id returning * into op;
    return op;
  end if;
  update public.cowork_operations set status='executing',lease_token=p_lease,
    run_attempt_token=p_run_lease,attempts=attempts+1,
    operation_expires_at=least(now()+interval '120 seconds',r.lease_expires_at),updated_at=now()
    where id=op.id returning * into op;
  return op;
end; $$;

create function public.cowork_finish_operation_v2(
  p_id uuid, p_lease uuid, p_run_lease uuid, p_success boolean,
  p_result jsonb, p_error_code text
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; op public.cowork_operations; parent_id uuid;
begin
  select run_id into parent_id from public.cowork_operations where id=p_id;
  if not found then return false; end if;
  -- Same lock order as reserve and cancellation: parent, then operation.
  select * into r from public.cowork_runs where id=parent_id for update;
  if not found or r.status<>'running' or p_run_lease is null
    or r.lease_token is distinct from p_run_lease
    or r.lease_expires_at is null or r.lease_expires_at<=now() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g
    join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled
      and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
      and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_operations set
    status=case when p_success then 'completed' else 'failed' end,
    result=case when p_success then coalesce(p_result,'null'::jsonb) else null end,
    error_code=case when p_success then null else left(coalesce(nullif(trim(p_error_code),''),'operation_failed'),100) end,
    updated_at=now()
    where id=p_id and run_id=r.id and user_id=r.user_id and organization_id=r.organization_id
      and lease_token=p_lease and run_attempt_token=p_run_lease
      and status='executing' and operation_expires_at>now();
  return found;
end; $$;

revoke all on function public.cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid) to service_role;
revoke all on function public.cowork_finish_operation_v2(uuid,uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.cowork_finish_operation_v2(uuid,uuid,uuid,boolean,jsonb,text) to service_role;
