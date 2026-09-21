-- Serialize reservations across all branches, not only the ancestor chain.
-- No ledger reset: historical reservations still count in the complete tree.
create or replace function public.cowork_reserve_model_call(p_run_id uuid,p_token uuid,p_role text,p_task_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  r public.cowork_runs;
  cursor_id uuid;
  parent_id uuid;
  root_id uuid;
  visited uuid[];
  calls integer;
  tokens bigint;
  role_calls integer;
  requested integer;
  admitted uuid;
begin
  select * into r from public.cowork_runs where id=p_run_id;
  if not found or p_token is null then raise exception 'Model run unavailable'; end if;
  cursor_id:=r.id;
  visited:=array[r.id];
  loop
    select parent_run_id into parent_id from public.cowork_runs
      where id=cursor_id and user_id=r.user_id and organization_id=r.organization_id;
    if not found then raise exception 'Invalid thread ancestry'; end if;
    exit when parent_id is null;
    if parent_id=any(visited) or cardinality(visited)>=13 then
      raise exception 'Invalid thread ancestry';
    end if;
    visited:=visited||parent_id;
    cursor_id:=parent_id;
  end loop;
  root_id:=cursor_id;
  -- Every branch takes the same lock before reading the aggregate. Locking
  -- only the current run permits siblings to spend the same remaining cup.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(root_id::text, 41004));
  select * into r from public.cowork_runs where id=p_run_id for update;
  if not found then raise exception 'Model run unavailable'; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then raise exception 'Model access revoked'; end if;
  if p_role='coordinator' then
    if r.status<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() or r.lease_expires_at is null
      then raise exception 'Model attempt expired'; end if;
    requested:=6000;
  else
    if p_role is null or p_role not in ('analyst','researcher','verifier') or r.status<>'waiting_workers' or not exists(
      select 1 from public.cowork_specialist_tasks where id=p_task_id and run_id=r.id and role=p_role
        and status='executing' and lease_token=p_token and lease_expires_at>clock_timestamp())
      then raise exception 'Specialist attempt unavailable'; end if;
    requested:=1800;
  end if;
  select count(*),coalesce(sum(output_reserved),0),count(*) filter(where role=p_role)
    into calls,tokens,role_calls from public.cowork_model_calls where run_id=r.id;
  if calls>=7 or tokens+requested>33600 or (p_role='coordinator' and role_calls>=5)
    or (p_role<>'coordinator' and role_calls>=1) then raise exception 'Model budget exhausted'; end if;
  with recursive conversation(id) as (
    select root_id
    union
    select child.id from public.cowork_runs child join conversation parent on child.parent_run_id=parent.id
      where child.user_id=r.user_id and child.organization_id=r.organization_id
  ) select count(*),coalesce(sum(c.output_reserved),0) into calls,tokens
    from public.cowork_model_calls c join conversation t on t.id=c.run_id;
  if calls>=25 or tokens+requested>100000 then raise exception 'Model budget exhausted'; end if;
  insert into public.cowork_model_calls(run_id,user_id,organization_id,role,output_reserved)
    values(r.id,r.user_id,r.organization_id,p_role,requested) returning id into admitted;
  return admitted;
end; $$;
revoke all on function public.cowork_reserve_model_call(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cowork_reserve_model_call(uuid,uuid,text,uuid) to service_role;
-- Remote migration ledger version: 20260921015112.
