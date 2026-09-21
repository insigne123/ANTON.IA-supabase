-- Applied via MCP as 20260920205105. Deploy compatible readers before enabling.
alter table public.cowork_runs drop constraint cowork_runs_status_check;
alter table public.cowork_runs add constraint cowork_runs_status_check
  check(status in ('queued','running','waiting_approval','waiting_workers','completed','failed','cancelled'));

create table public.cowork_specialist_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check(role in ('analyst','researcher','verifier')),
  assignment jsonb not null check(octet_length(assignment::text)<=40000),
  status text not null default 'pending' check(status in ('pending','executing','completed','failed','uncertain','cancelled')),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb,
  usage jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,role)
);
create index cowork_specialist_pending on public.cowork_specialist_tasks(user_id,status,created_at);
alter table public.cowork_specialist_tasks enable row level security;
revoke all on public.cowork_specialist_tasks from anon,authenticated;
grant select on public.cowork_specialist_tasks to authenticated;
grant all on public.cowork_specialist_tasks to service_role;
create policy cowork_specialist_private on public.cowork_specialist_tasks for select to authenticated
  using(user_id=auth.uid() and public.cowork_has_access(organization_id));

create function public.cowork_enqueue_specialists(p_run_id uuid,p_token uuid,p_assignments jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; item jsonb;
begin
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) not between 1 and 2
    or octet_length(p_assignments::text)>80000 then raise exception 'Invalid assignments'; end if;
  select * into r from public.cowork_runs where id=p_run_id for update;
  if not found or r.status<>'running' or p_token is null or r.lease_token is distinct from p_token
    or r.lease_expires_at is null or r.lease_expires_at<=now() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  if exists(select 1 from public.cowork_specialist_tasks where run_id=r.id) then
    raise exception 'Specialist budget already consumed';
  end if;
  for item in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(item->'task') is distinct from 'object'
      or jsonb_typeof(item->'evidence') is distinct from 'array'
      or jsonb_array_length(item->'evidence') not between 1 and 3
      or length(item->'task'->>'objective') not between 1 and 600
      or item->'task'->>'objective' is null then raise exception 'Invalid specialist assignment'; end if;
    insert into public.cowork_specialist_tasks(run_id,user_id,organization_id,role,assignment)
      values(r.id,r.user_id,r.organization_id,item->'task'->>'role',item);
  end loop;
  update public.cowork_runs set status='waiting_workers',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'specialists.queued',jsonb_build_object('count',jsonb_array_length(p_assignments)));
  return true;
end; $$;

-- Caller already owns the parent lock. Results and wakeup are atomic.
create function public.cowork_settle_specialists(p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; outcome jsonb;
begin
  select * into r from public.cowork_runs where id=p_run_id for update;
  if not found or r.status<>'waiting_workers' then return false; end if;
  if not exists(select 1 from public.cowork_specialist_tasks where run_id=r.id)
    or exists(select 1 from public.cowork_specialist_tasks where run_id=r.id and status in ('pending','executing')) then return false; end if;
  select jsonb_agg(jsonb_build_object('role',role,'status',status,'result',result,'usage',usage,'error',error_code) order by role)
    into outcome from public.cowork_specialist_tasks where run_id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'tool.completed',
      jsonb_build_object('action','specialists.review','input','','result',outcome));
  update public.cowork_runs set status='queued',updated_at=now() where id=r.id;
  return true;
end; $$;

create function public.cowork_take_specialist(p_user_id uuid)
returns setof public.cowork_specialist_tasks language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; job public.cowork_specialist_tasks;
begin
  -- One parent lock serializes claim/finalization/cancellation consistently.
  for r in select runs.* from public.cowork_runs runs
    where runs.user_id=p_user_id and runs.status='waiting_workers'
    order by runs.created_at limit 20 for update skip locked loop
    if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
      join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
      and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
      and m.organization_id=r.organization_id) then
      update public.cowork_specialist_tasks set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
        where run_id=r.id and status in ('pending','executing');
      update public.cowork_runs set status='cancelled',updated_at=now() where id=r.id;
      insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
        values(r.id,r.user_id,r.organization_id,'run.cancelled','{"reason":"access_revoked"}'::jsonb);
      continue;
    end if;
    update public.cowork_specialist_tasks set status='uncertain',error_code='outcome_unknown',updated_at=now()
      where run_id=r.id and status='executing' and lease_expires_at<=now();
    if public.cowork_settle_specialists(r.id) then continue; end if;
    select * into job from public.cowork_specialist_tasks
      where run_id=r.id and status='pending' order by created_at,role limit 1 for update skip locked;
    if found then
      update public.cowork_specialist_tasks set status='executing',lease_token=gen_random_uuid(),
        lease_expires_at=now()+interval '60 seconds',updated_at=now() where id=job.id returning * into job;
      return next job; return;
    end if;
  end loop;
end; $$;

create function public.cowork_finish_specialist(p_id uuid,p_token uuid,p_success boolean,p_result jsonb,p_usage jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; parent_id uuid;
begin
  if octet_length(coalesce(p_result,'null'::jsonb)::text)>20000 or octet_length(coalesce(p_usage,'null'::jsonb)::text)>4000 then
    raise exception 'Specialist output too large'; end if;
  select run_id into parent_id from public.cowork_specialist_tasks where id=p_id;
  if not found then return false; end if;
  select * into r from public.cowork_runs where id=parent_id for update;
  if not found or r.status<>'waiting_workers' then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_specialist_tasks set status=case when p_success then 'completed' else 'failed' end,
    result=case when p_success then p_result else null end,usage=p_usage,
    error_code=case when p_success then null else left(coalesce(p_error,'generation_failed'),100) end,updated_at=now()
    where id=p_id and lease_token=p_token and status='executing' and lease_expires_at>now();
  if not found then return false; end if;
  perform public.cowork_settle_specialists(r.id);
  return true;
end; $$;

-- Cancel retains the original scope checks and now also cancels queued specialists.
create or replace function public.cowork_cancel_run(p_user_id uuid,p_organization_id uuid,p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  update public.cowork_runs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id
      and status in ('queued','running','waiting_approval','waiting_workers')
      and exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
        where g.user_id=p_user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null)
      and exists(select 1 from public.organization_members m where m.user_id=p_user_id and m.organization_id=p_organization_id)
    returning * into r;
  if not found then return false; end if;
  update public.cowork_specialist_tasks set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where run_id=r.id and status in ('pending','executing');
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind) values(r.id,r.user_id,r.organization_id,'run.cancelled');
  return true;
end; $$;

revoke all on function public.cowork_enqueue_specialists(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.cowork_settle_specialists(uuid) from public,anon,authenticated;
revoke all on function public.cowork_take_specialist(uuid) from public,anon,authenticated;
revoke all on function public.cowork_finish_specialist(uuid,uuid,boolean,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.cowork_cancel_run(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cowork_enqueue_specialists(uuid,uuid,jsonb) to service_role;
grant execute on function public.cowork_settle_specialists(uuid) to service_role;
grant execute on function public.cowork_take_specialist(uuid) to service_role;
grant execute on function public.cowork_finish_specialist(uuid,uuid,boolean,jsonb,jsonb,text) to service_role;
grant execute on function public.cowork_cancel_run(uuid,uuid,uuid) to service_role;
