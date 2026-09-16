-- Applied in production; version aligned with the remote ledger.
create table public.cowork_search_proposals (
  run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  criteria jsonb not null,
  status text not null default 'pending' check(status in ('pending','executing','completed','rejected','failed')),
  foreign key(run_id,user_id,organization_id) references public.cowork_runs(id,user_id,organization_id)
);
alter table public.cowork_search_proposals enable row level security;
revoke all on public.cowork_search_proposals from anon,authenticated;
grant all on public.cowork_search_proposals to service_role;

create function public.cowork_propose_search(p_run_id uuid,p_token uuid,p_criteria jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  select * into r from public.cowork_runs where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  insert into public.cowork_search_proposals(run_id,user_id,organization_id,criteria) values(r.id,r.user_id,r.organization_id,p_criteria);
  update public.cowork_runs set status='waiting_approval',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',jsonb_build_object('action','prospecting.search','criteria',p_criteria));
  return true;
end; $$;

-- A claim is never automatically retried: the provider may have accepted work.
create function public.cowork_claim_search(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_search_proposals;
begin
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then return null; end if;
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found or r.status<>'waiting_approval' then return null; end if;
  select * into p from public.cowork_search_proposals where run_id=r.id for update;
  if not found or p.status<>'pending' then return null; end if;
  update public.cowork_search_proposals set status=case when p_approve then 'executing' else 'rejected' end where run_id=r.id;
  if not p_approve then
    update public.cowork_runs set status='completed',updated_at=now() where id=r.id;
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
      values(r.id,r.user_id,r.organization_id,'run.completed','{"reply":"Búsqueda descartada. No se consultó el proveedor.","document":null}'::jsonb);
  else
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
      values(r.id,r.user_id,r.organization_id,'search.started','{}'::jsonb);
  end if;
  return jsonb_build_object('criteria',p.criteria,'approved',p_approve);
end; $$;

create function public.cowork_finish_search(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_success boolean,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  update public.cowork_search_proposals set status=case when p_success then 'completed' else 'failed' end where run_id=r.id and status='executing';
  if not found then return false; end if;
  -- Retain cancellation; in-flight provider results must not revive the run.
  if r.status<>'waiting_approval' then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if p_success then
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload) values(r.id,r.user_id,r.organization_id,'tool.completed',p_payload);
  end if;
  update public.cowork_runs set status=case when p_success then 'completed' else 'failed' end,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,case when p_success then 'run.completed' else 'run.failed' end,
      case when p_success then jsonb_build_object('reply','Búsqueda terminada. Revisa los contactos encontrados; todavía no se han guardado en tu base.','document',null)
        else '{"message":"No pudimos confirmar el resultado de la búsqueda. No se reintentará automáticamente."}'::jsonb end);
  return true;
end; $$;
revoke all on function public.cowork_propose_search(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.cowork_claim_search(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.cowork_finish_search(uuid,uuid,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_propose_search(uuid,uuid,jsonb) to service_role;
grant execute on function public.cowork_claim_search(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.cowork_finish_search(uuid,uuid,uuid,boolean,jsonb) to service_role;
