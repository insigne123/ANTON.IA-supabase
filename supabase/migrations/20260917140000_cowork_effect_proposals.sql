-- Conversational effect proposals: the agent proposes save/research/draft work,
-- the owner approves once, and the worker executes exactly once.
create table public.cowork_effect_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check(kind in ('save_contact','start_research','request_draft')),
  origin_run_id uuid not null references public.cowork_runs(id) on delete cascade,
  target_id text not null check(length(target_id) between 1 and 300),
  label text not null check(length(label) between 1 and 280),
  status text not null default 'proposed' check(status in ('proposed','approved','executing','executed','failed','rejected')),
  result jsonb,
  error_code text check(error_code is null or length(error_code) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cowork_effect_proposals_status_idx on public.cowork_effect_proposals(status,created_at);
alter table public.cowork_effect_proposals enable row level security;
revoke all on public.cowork_effect_proposals from anon,authenticated;
grant select on public.cowork_effect_proposals to authenticated;
grant all on public.cowork_effect_proposals to service_role;
create policy cowork_effect_proposals_private on public.cowork_effect_proposals for select to authenticated
  using(user_id=auth.uid() and public.cowork_has_access(organization_id));

create function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind not in ('save_contact','start_research','request_draft') then raise exception 'Unknown effect' using errcode='22023'; end if;
  if p_target_id is null or length(trim(p_target_id)) = 0 or length(p_target_id) > 300 then raise exception 'Invalid target' using errcode='22023'; end if;
  if p_label is null or length(trim(p_label)) = 0 or length(p_label) > 280 then raise exception 'Invalid label' using errcode='22023'; end if;
  select * into r from public.cowork_runs where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  perform 1 from public.cowork_runs where id=p_origin_run_id and user_id=r.user_id and organization_id=r.organization_id and status='completed';
  if not found then raise exception 'Origin unavailable' using errcode='22023'; end if;
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

create function public.cowork_resolve_effect(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then return false; end if;
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found then return false; end if;
  if p.status='executed' then return p_approve; end if;
  if p.status in ('rejected','failed') then return not p_approve; end if;
  if r.status<>'waiting_approval' or p.status<>'proposed' then return false; end if;
  if p_approve then
    update public.cowork_effect_proposals set status='approved',updated_at=now() where run_id=r.id;
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
      values(r.id,r.user_id,r.organization_id,'effect.approved',jsonb_build_object('kind',p.kind,'label',p.label));
  else
    update public.cowork_effect_proposals set status='rejected',updated_at=now() where run_id=r.id;
    update public.cowork_runs set status='completed',updated_at=now() where id=r.id;
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
      values(r.id,r.user_id,r.organization_id,'run.completed',
        jsonb_build_object('reply','Propuesta descartada. No se ejecutó ningún cambio.','document',null,'action','cowork.effect','applied',false));
  end if;
  return true;
end; $$;
revoke all on function public.cowork_resolve_effect(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.cowork_resolve_effect(uuid,uuid,uuid,boolean) to service_role;

create function public.cowork_take_effect(p_user_id uuid)
returns setof public.cowork_effect_proposals language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select r2.* into r from public.cowork_runs r2
    where r2.user_id=p_user_id and r2.status='waiting_approval'
      and exists(select 1 from public.cowork_effect_proposals s where s.run_id=r2.id and s.status='approved')
      and exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
        where g.user_id=r2.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r2.organization_id)
    order by r2.created_at limit 1 for update of r2 skip locked;
  if not found then return; end if;
  update public.cowork_effect_proposals set status='executing',updated_at=now() where run_id=r.id and status='approved' returning * into p;
  if not found then return; end if;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'effect.started',jsonb_build_object('kind',p.kind,'label',p.label));
  return next p;
end; $$;
revoke all on function public.cowork_take_effect(uuid) from public,anon,authenticated;
grant execute on function public.cowork_take_effect(uuid) to service_role;

create function public.cowork_finish_effect(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_success boolean,p_reply text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found then return false; end if;
  if r.status<>'waiting_approval' or p.status<>'executing' then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_effect_proposals set status=case when p_success then 'executed' else 'failed' end,
    result=case when p_success then coalesce(p_result,'null'::jsonb) else null end,
    error_code=case when p_success then null else left(coalesce(nullif(trim(p_result::text),'null'),'effect_failed'),100) end,
    updated_at=now() where run_id=r.id;
  update public.cowork_runs set status='completed',updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,case when p_success then 'effect.completed' else 'effect.failed' end,
      jsonb_build_object('kind',p.kind,'label',p.label,'result',coalesce(p_result,'null'::jsonb)));
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'run.completed',
      jsonb_build_object('reply',left(coalesce(nullif(trim(p_reply),''),'Trabajo terminado.'),2000),'document',null,'action','cowork.effect','applied',p_success));
  return true;
end; $$;
revoke all on function public.cowork_finish_effect(uuid,uuid,uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_finish_effect(uuid,uuid,uuid,boolean,text,jsonb) to service_role;
