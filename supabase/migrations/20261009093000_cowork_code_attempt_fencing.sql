-- Code-only finalization fencing. The timestamp returned by cowork_take_effect identifies its current claim.
-- No sends or other effects are reclaimed or replayed by this migration.
create or replace function public.cowork_finish_code_effect(
  p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_attempt_at timestamptz,
  p_success boolean,p_reply text,p_result jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found or r.status<>'waiting_approval' then return false; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found or p.kind<>'code_execute' or p.status<>'executing' or p_attempt_at is null or p.updated_at is distinct from p_attempt_at
    or p_attempt_at < clock_timestamp()-interval '180 seconds' then return false; end if;
  -- Existing function revalidates access and publishes the entire result in the same locked transaction.
  return public.cowork_finish_effect(p_run_id,p_user_id,p_organization_id,p_success,p_reply,p_result);
end; $$;

create or replace function public.cowork_requeue_code_effect(
  p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_attempt_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found or r.status<>'waiting_approval' then return false; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found or p.kind<>'code_execute' or p.status<>'executing' or p_attempt_at is null or p.updated_at is distinct from p_attempt_at then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email)
    and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_effect_proposals set status='approved',updated_at=clock_timestamp() where run_id=r.id;
  return true;
end; $$;

create or replace function public.cowork_mark_code_dispatch(
  p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_attempt_at timestamptz,p_job_id text,p_request_hash text
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found or r.status<>'waiting_approval' then return false; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found or p.kind<>'code_execute' or p.status<>'executing' or p_attempt_at is null or p.updated_at is distinct from p_attempt_at
    or p_attempt_at < clock_timestamp()-interval '180 seconds' then return false; end if;
  if p_job_id is distinct from 'cowork-code-'||r.id::text or p_request_hash !~ '^[a-f0-9]{64}$' or p_request_hash is null then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email)
    and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if exists(select 1 from public.cowork_run_events where run_id=r.id and kind='build.dispatched') then return false; end if;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'build.dispatched',jsonb_build_object('jobId',p_job_id,'requestHash',p_request_hash));
  return true;
end; $$;
revoke all on function public.cowork_finish_code_effect(uuid,uuid,uuid,timestamptz,boolean,text,jsonb),
  public.cowork_requeue_code_effect(uuid,uuid,uuid,timestamptz),public.cowork_mark_code_dispatch(uuid,uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.cowork_finish_code_effect(uuid,uuid,uuid,timestamptz,boolean,text,jsonb),
  public.cowork_requeue_code_effect(uuid,uuid,uuid,timestamptz),public.cowork_mark_code_dispatch(uuid,uuid,uuid,timestamptz,text,text) to service_role;
