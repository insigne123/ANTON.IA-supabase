-- Pending: apply after cowork_external_search. Approved search is background work.
alter table public.cowork_search_proposals drop constraint cowork_search_proposals_status_check;
alter table public.cowork_search_proposals add constraint cowork_search_proposals_status_check
  check(status in ('pending','approved','executing','completed','rejected','failed'));
alter table public.cowork_search_proposals add column started_at timestamptz;
create index cowork_search_approved_queue on public.cowork_search_proposals(status) where status in ('approved','executing');

create or replace function public.cowork_claim_search(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_search_proposals;
begin
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then return null; end if;
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return null; end if;
  select * into p from public.cowork_search_proposals where run_id=r.id for update;
  if not found then return null; end if;
  if r.status='cancelled' then return null; end if;
  if p_approve and p.status in ('approved','executing','completed') then return jsonb_build_object('approved',true,'reused',true); end if;
  if not p_approve and p.status='rejected' then return jsonb_build_object('approved',false,'reused',true); end if;
  if r.status<>'waiting_approval' or p.status<>'pending' then return null; end if;
  update public.cowork_search_proposals set status=case when p_approve then 'approved' else 'rejected' end where run_id=r.id;
  if not p_approve then
    update public.cowork_runs set status='completed',updated_at=now() where id=r.id;
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
      values(r.id,r.user_id,r.organization_id,'run.completed','{"reply":"Búsqueda descartada. No se consultó el proveedor.","document":null}'::jsonb);
  else
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
      values(r.id,r.user_id,r.organization_id,'search.approved','{}'::jsonb);
  end if;
  return jsonb_build_object('approved',p_approve,'reused',false);
end; $$;

create function public.cowork_take_search(p_user_id uuid)
returns setof public.cowork_search_proposals language plpgsql security definer set search_path='' as $$
declare job public.cowork_runs; p public.cowork_search_proposals;
begin
  -- Locks always run -> proposal, matching approve/cancel/finish.
  for job in select r.* from public.cowork_runs r
    where r.user_id=p_user_id and exists(select 1 from public.cowork_search_proposals s
      where s.run_id=r.id and s.status='executing' and (s.started_at is null or s.started_at<now()-interval '180 seconds'))
    order by r.created_at limit 20 for update of r skip locked
  loop
    update public.cowork_search_proposals set status='failed' where run_id=job.id and status='executing';
    if found and job.status='waiting_approval' then
      update public.cowork_runs set status='failed',updated_at=now() where id=job.id;
      insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
        values(job.id,job.user_id,job.organization_id,'run.failed','{"message":"La búsqueda se interrumpió y su resultado no está confirmado. No se repetirá automáticamente para evitar otro consumo.","reason":"search_outcome_unknown"}'::jsonb);
    end if;
  end loop;
  select r.* into job from public.cowork_runs r
    where r.user_id=p_user_id and r.status='waiting_approval'
      and exists(select 1 from public.cowork_search_proposals s where s.run_id=r.id and s.status='approved')
      and exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
        where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id)
    order by r.created_at limit 1 for update of r skip locked;
  if not found then return; end if;
  update public.cowork_search_proposals set status='executing',started_at=now() where run_id=job.id and status='approved' returning * into p;
  if not found then return; end if;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(job.id,job.user_id,job.organization_id,'search.started','{}'::jsonb);
  return next p;
end; $$;
revoke all on function public.cowork_take_search(uuid) from public,anon,authenticated;
grant execute on function public.cowork_take_search(uuid) to service_role;
