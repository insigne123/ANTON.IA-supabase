-- Applied in production: fence completion by attempt, not only by executing status.
alter function public.cowork_finish_draft(uuid,uuid,uuid,uuid,boolean,text,text,text,text)
  rename to cowork_finish_draft_legacy;
revoke all on function public.cowork_finish_draft_legacy(uuid,uuid,uuid,uuid,boolean,text,text,text,text) from service_role;

create function public.cowork_finish_draft(p_run_id uuid,p_snapshot_id uuid,p_user_id uuid,
  p_organization_id uuid,p_attempt integer,p_success boolean,p_draft_id text,p_subject text,p_text text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=p_user_id and g.enabled
    and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null
    and m.organization_id=p_organization_id) then return false; end if;
  perform 1 from public.cowork_draft_requests where run_id=p_run_id and snapshot_id=p_snapshot_id
    and user_id=p_user_id and organization_id=p_organization_id and status='executing'
    and attempts=p_attempt for update;
  if not found then return false; end if;
  return public.cowork_finish_draft_legacy(p_run_id,p_snapshot_id,p_user_id,p_organization_id,p_success,p_draft_id,p_subject,p_text,p_error);
end; $$;
revoke all on function public.cowork_finish_draft(uuid,uuid,uuid,uuid,integer,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.cowork_finish_draft(uuid,uuid,uuid,uuid,integer,boolean,text,text,text,text) to service_role;

create or replace function public.cowork_take_draft(p_user_id uuid)
returns setof public.cowork_draft_requests language plpgsql security definer set search_path='' as $$
declare job public.cowork_runs; d public.cowork_draft_requests;
begin
  for job in select r.* from public.cowork_runs r where r.user_id=p_user_id
    and exists(select 1 from public.cowork_draft_requests q where q.run_id=r.id and q.status='executing'
      and q.started_at<now()-interval '180 seconds')
    order by r.created_at limit 20 for update of r skip locked
  loop
    -- No automatic replay: native identity also depends on seller/style hashes.
    -- A retry after a profile change could otherwise produce a second draft.
    for d in update public.cowork_draft_requests set status='failed',updated_at=now()
      where run_id=job.id and status='executing' and started_at<now()-interval '180 seconds'
      returning *
    loop
      insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
        values(job.id,job.user_id,job.organization_id,'draft.failed',jsonb_build_object('snapshotId',d.snapshot_id,
          'message','La generación se interrumpió. Revisa los borradores existentes antes de solicitar otra generación.','reason','draft_outcome_unknown'));
    end loop;
  end loop;
  select r.* into job from public.cowork_runs r where r.user_id=p_user_id and r.status='completed'
    and exists(select 1 from public.cowork_draft_requests q where q.run_id=r.id and q.status='pending')
    and exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
      join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
      and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id)
    order by r.created_at limit 1 for update of r skip locked;
  if not found then return; end if;
  select * into d from public.cowork_draft_requests where run_id=job.id and status='pending' order by created_at limit 1 for update;
  if not found then return; end if;
  update public.cowork_draft_requests set status='executing',started_at=now(),attempts=attempts+1,updated_at=now()
    where run_id=d.run_id and snapshot_id=d.snapshot_id returning * into d;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(job.id,job.user_id,job.organization_id,'draft.started',jsonb_build_object('snapshotId',d.snapshot_id,'attempt',d.attempts));
  return next d;
end; $$;
