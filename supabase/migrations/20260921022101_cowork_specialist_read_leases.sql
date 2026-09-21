-- Applied via MCP as 20260921022101. Read-only specialist tools share the fenced ledger.
create function public.cowork_attempt_deadline(p_run_id uuid,p_token uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
  select case when r.status='running' and r.lease_token=p_token then r.lease_expires_at
    when r.status='waiting_workers' then (
      select t.lease_expires_at from public.cowork_specialist_tasks t
      where t.run_id=r.id and t.status='executing' and t.lease_token=p_token limit 1)
    else null end from public.cowork_runs r where r.id=p_run_id
$$;
revoke all on function public.cowork_attempt_deadline(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cowork_attempt_deadline(uuid,uuid) to service_role;

create or replace function public.cowork_reserve_operation_v2(
  p_user_id uuid,p_organization_id uuid,p_run_id uuid,p_capability text,p_version integer,
  p_input jsonb,p_input_hash text,p_lease uuid,p_run_lease uuid
) returns public.cowork_operations language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; op public.cowork_operations; retryable boolean; deadline timestamptz; task public.cowork_specialist_tasks;
begin
  select * into r from public.cowork_runs where id=p_run_id for update;
  deadline:=public.cowork_attempt_deadline(p_run_id,p_run_lease);
  if r.id is null or r.user_id<>p_user_id or r.organization_id<>p_organization_id
    or p_run_lease is null or deadline is null or deadline<=clock_timestamp() then
    raise exception 'Run attempt unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=p_user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=p_organization_id) then raise exception 'Access revoked' using errcode='42501'; end if;
  if p_lease is null or p_input_hash is null or length(p_input_hash)<>64 then
    raise exception 'Invalid reservation' using errcode='22023'; end if;
  retryable:=p_capability in ('leads.search','leads.get','research.get_existing','crm.search','crm.get_lead',
    'contacted.search','contacted.timeline','metrics.overview','app.context','draft.get','campaigns.list','files.list',
    'saved_searches.list','profile.get','missions.list','exceptions.list','campaigns.inbox','campaigns.plan',
    'campaigns.step_context','crm.collaboration','crm.record','privacy.contactability','privacy.contactability_batch','specialists.plan');
  if r.status='waiting_workers' then
    select * into task from public.cowork_specialist_tasks where run_id=r.id and lease_token=p_run_lease and status='executing';
    -- The immutable assignment authorizes exactly one tool and its exact input.
    if not retryable or task.id is null or task.assignment->'task'->'read'->>'action' is distinct from p_capability
      or task.assignment->'task'->'read'->'input' is distinct from p_input
      or not (case task.role
        when 'analyst' then p_capability in ('metrics.overview','crm.record')
        when 'researcher' then p_capability in ('research.get_existing','leads.get')
        when 'verifier' then p_capability in ('privacy.contactability','crm.collaboration')
        else false end) then raise exception 'Specialist tool unavailable' using errcode='42501'; end if;
  end if;
  insert into public.cowork_operations(user_id,organization_id,run_id,capability,version,input,input_hash,
    lease_token,status,attempts,operation_expires_at,run_attempt_token)
    values(p_user_id,p_organization_id,p_run_id,p_capability,p_version,coalesce(p_input,'null'::jsonb),p_input_hash,
      p_lease,'executing',1,least(clock_timestamp()+interval '120 seconds',deadline),p_run_lease)
    on conflict(user_id,organization_id,capability,version,input_hash) do nothing;
  select * into op from public.cowork_operations where user_id=p_user_id and organization_id=p_organization_id
    and capability=p_capability and version=p_version and input_hash=p_input_hash for update;
  if op.run_id<>p_run_id or op.input is distinct from coalesce(p_input,'null'::jsonb) then
    raise exception 'Reservation conflict' using errcode='22023'; end if;
  if op.status in ('completed','failed','cancelled') then return op; end if;
  if op.operation_expires_at is null then raise exception 'Legacy reservation unavailable' using errcode='55000'; end if;
  if op.operation_expires_at>clock_timestamp() and op.run_attempt_token=p_run_lease then return op; end if;
  if not retryable or op.attempts>=3 then
    update public.cowork_operations set status='failed',error_code=case when retryable then 'attempts_exhausted' else 'outcome_unknown' end,
      updated_at=now() where id=op.id returning * into op;
    return op;
  end if;
  update public.cowork_operations set status='executing',lease_token=p_lease,run_attempt_token=p_run_lease,
    attempts=attempts+1,operation_expires_at=least(clock_timestamp()+interval '120 seconds',deadline),updated_at=now()
    where id=op.id returning * into op;
  return op;
end; $$;

create or replace function public.cowork_finish_operation_v2(p_id uuid,p_lease uuid,p_run_lease uuid,
  p_success boolean,p_result jsonb,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; parent_id uuid; deadline timestamptz;
begin
  select run_id into parent_id from public.cowork_operations where id=p_id;
  if not found then return false; end if;
  select * into r from public.cowork_runs where id=parent_id for update;
  deadline:=public.cowork_attempt_deadline(parent_id,p_run_lease);
  if r.id is null or p_run_lease is null or deadline is null or deadline<=clock_timestamp() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_operations set status=case when p_success then 'completed' else 'failed' end,
    result=case when p_success then coalesce(p_result,'null'::jsonb) else null end,
    error_code=case when p_success then null else left(coalesce(nullif(trim(p_error_code),''),'operation_failed'),100) end,
    updated_at=now() where id=p_id and run_id=r.id and user_id=r.user_id and organization_id=r.organization_id
      and lease_token=p_lease and run_attempt_token=p_run_lease and status='executing' and operation_expires_at>clock_timestamp();
  return found;
end; $$;
revoke all on function public.cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid) to service_role;
revoke all on function public.cowork_finish_operation_v2(uuid,uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.cowork_finish_operation_v2(uuid,uuid,uuid,boolean,jsonb,text) to service_role;
