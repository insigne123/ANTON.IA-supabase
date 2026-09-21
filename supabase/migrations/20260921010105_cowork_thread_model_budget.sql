-- Fase 4: el presupuesto de modelo se agrega por hilo de conversación, no
-- solo por trabajo. Recorre parent_run_id (máximo 12 niveles, ciclos
-- rechazados) y exige el mismo usuario/organización en toda la cadena.
-- Endurece en dirección fail-closed: conserva todos los topes por trabajo y
-- añade topes agregados. Sin cambios de tablas, RLS ni grants.
create or replace function public.cowork_reserve_model_call(p_run_id uuid,p_token uuid,p_role text,p_task_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; calls integer; tokens bigint; role_calls integer; requested integer; admitted uuid;
declare thread_ids uuid[]; cursor_id uuid; parent_id uuid; thread_calls integer; thread_tokens bigint;
begin
  select * into r from public.cowork_runs where id=p_run_id for update;
  if not found or p_token is null then raise exception 'Model run unavailable'; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then raise exception 'Model access revoked'; end if;
  if p_role='coordinator' then
    if r.status<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=now() or r.lease_expires_at is null
      then raise exception 'Model attempt expired'; end if;
    requested:=6000;
  else
    if r.status<>'waiting_workers' or not exists(select 1 from public.cowork_specialist_tasks
      where id=p_task_id and run_id=r.id and role=p_role and status='executing'
      and lease_token=p_token and lease_expires_at>now()) then raise exception 'Specialist attempt unavailable'; end if;
    requested:=1800;
  end if;
  -- Per-run caps (unchanged).
  select count(*),coalesce(sum(output_reserved),0),count(*) filter(where role=p_role)
  into calls,tokens,role_calls from public.cowork_model_calls where run_id=r.id;
  if calls>=7 or tokens+requested>33600 or (p_role='coordinator' and role_calls>=5)
    or (p_role<>'coordinator' and role_calls>=1) then raise exception 'Model budget exhausted'; end if;
  -- Thread-aggregate caps across the automatic chain (parent_run_id walk).
  thread_ids := array[r.id];
  cursor_id := r.id;
  for i in 1..12 loop
    select parent_run_id into parent_id from public.cowork_runs
      where id=cursor_id and user_id=r.user_id and organization_id=r.organization_id;
    exit when parent_id is null;
    if parent_id = any(thread_ids) then raise exception 'Invalid thread ancestry'; end if;
    if not exists(select 1 from public.cowork_runs
      where id=parent_id and user_id=r.user_id and organization_id=r.organization_id) then
      raise exception 'Invalid thread ancestry'; end if;
    thread_ids := thread_ids || parent_id;
    cursor_id := parent_id;
  end loop;
  select count(*),coalesce(sum(output_reserved),0)
  into thread_calls,thread_tokens from public.cowork_model_calls where run_id = any(thread_ids);
  if thread_calls>=25 or thread_tokens+requested>100000 then raise exception 'Model budget exhausted'; end if;
  insert into public.cowork_model_calls(run_id,user_id,organization_id,role,output_reserved)
  values(r.id,r.user_id,r.organization_id,p_role,requested) returning id into admitted;
  return admitted;
end; $$;
revoke all on function public.cowork_reserve_model_call(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cowork_reserve_model_call(uuid,uuid,text,uuid) to service_role;
-- Remote migration ledger version: 20260921010105.
