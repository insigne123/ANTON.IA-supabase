-- Durable Cowork operation ledger: idempotent reserve/claim/result/replay per exact input.
create table public.cowork_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.cowork_runs(id) on delete cascade,
  capability text not null check(length(capability) between 1 and 80),
  version integer not null check(version > 0),
  input jsonb not null,
  input_hash text not null check(length(input_hash) between 16 and 128),
  status text not null default 'reserved' check(status in ('reserved','executing','completed','failed','cancelled')),
  lease_token uuid not null,
  attempts integer not null default 0 check(attempts >= 0),
  result jsonb,
  error_code text check(error_code is null or length(error_code) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,organization_id,capability,version,input_hash)
);
create index cowork_operations_run_idx on public.cowork_operations(run_id);
create index cowork_operations_status_idx on public.cowork_operations(user_id,organization_id,status,updated_at);
alter table public.cowork_operations enable row level security;
revoke all on public.cowork_operations from anon,authenticated;
grant select on public.cowork_operations to authenticated;
grant all on public.cowork_operations to service_role;
create policy cowork_operations_private on public.cowork_operations for select to authenticated
  using(user_id=auth.uid() and public.cowork_has_access(organization_id));

-- Reserve returns the existing row for an identical input (replay) instead of duplicating effects.
create function public.cowork_reserve_operation(p_user_id uuid,p_organization_id uuid,p_run_id uuid,
  p_capability text,p_version integer,p_input jsonb,p_input_hash text,p_lease uuid)
returns public.cowork_operations language plpgsql security definer set search_path='' as $$
declare row public.cowork_operations;
begin
  insert into public.cowork_operations(user_id,organization_id,run_id,capability,version,input,input_hash,lease_token)
    values(p_user_id,p_organization_id,p_run_id,p_capability,p_version,coalesce(p_input,'{}'::jsonb),p_input_hash,p_lease)
    on conflict(user_id,organization_id,capability,version,input_hash) do nothing;
  select * into row from public.cowork_operations
    where user_id=p_user_id and organization_id=p_organization_id and capability=p_capability
      and version=p_version and input_hash=p_input_hash;
  return row;
end; $$;
revoke all on function public.cowork_reserve_operation(uuid,uuid,uuid,text,integer,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.cowork_reserve_operation(uuid,uuid,uuid,text,integer,jsonb,text,uuid) to service_role;

-- Only the lease holder moves reserved/executing rows to a terminal state.
create function public.cowork_complete_operation(p_id uuid,p_lease uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.cowork_operations set status='completed',result=coalesce(p_result,'null'::jsonb),
    error_code=null,updated_at=now()
    where id=p_id and lease_token=p_lease and status in ('reserved','executing');
  return found;
end; $$;
revoke all on function public.cowork_complete_operation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_complete_operation(uuid,uuid,jsonb) to service_role;

create function public.cowork_fail_operation(p_id uuid,p_lease uuid,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.cowork_operations set status='failed',
    error_code=left(coalesce(nullif(trim(p_error_code),''),'operation_failed'),100),updated_at=now()
    where id=p_id and lease_token=p_lease and status in ('reserved','executing');
  return found;
end; $$;
revoke all on function public.cowork_fail_operation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cowork_fail_operation(uuid,uuid,text) to service_role;

create function public.cowork_cancel_operation(p_id uuid,p_user_id uuid,p_organization_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.cowork_operations set status='cancelled',updated_at=now()
    where id=p_id and user_id=p_user_id and organization_id=p_organization_id and status in ('reserved','executing');
  return found;
end; $$;
revoke all on function public.cowork_cancel_operation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cowork_cancel_operation(uuid,uuid,uuid) to service_role;
