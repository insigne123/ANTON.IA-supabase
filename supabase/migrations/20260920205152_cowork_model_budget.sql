-- Applied via MCP as 20260920205152. Shared coordinator/specialist admission.
create table public.cowork_model_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check(role in ('coordinator','analyst','researcher','verifier')),
  output_reserved integer not null check(output_reserved>0),
  created_at timestamptz not null default now()
);
create index cowork_model_calls_run on public.cowork_model_calls(run_id);
alter table public.cowork_model_calls enable row level security;
revoke all on public.cowork_model_calls from anon,authenticated;
grant select on public.cowork_model_calls to authenticated;
grant all on public.cowork_model_calls to service_role;
create policy cowork_model_calls_private on public.cowork_model_calls for select to authenticated
 using(user_id=auth.uid() and public.cowork_has_access(organization_id));

create function public.cowork_reserve_model_call(p_run_id uuid,p_token uuid,p_role text,p_task_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; calls integer; tokens bigint; role_calls integer; requested integer; admitted uuid;
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
 select count(*),coalesce(sum(output_reserved),0),count(*) filter(where role=p_role)
 into calls,tokens,role_calls from public.cowork_model_calls where run_id=r.id;
 if calls>=7 or tokens+requested>33600 or (p_role='coordinator' and role_calls>=5)
   or (p_role<>'coordinator' and role_calls>=1) then raise exception 'Model budget exhausted'; end if;
 insert into public.cowork_model_calls(run_id,user_id,organization_id,role,output_reserved)
 values(r.id,r.user_id,r.organization_id,p_role,requested) returning id into admitted;
 return admitted;
end; $$;
revoke all on function public.cowork_reserve_model_call(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.cowork_reserve_model_call(uuid,uuid,text,uuid) to service_role;
