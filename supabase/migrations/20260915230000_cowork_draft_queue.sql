-- Pending: apply after the five applied core migrations. Draft generation becomes background work.
create table public.cowork_draft_requests (
  run_id uuid not null,
  user_id uuid not null,
  organization_id uuid not null,
  snapshot_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'executing', 'completed', 'failed')),
  attempts integer not null default 0,
  started_at timestamptz,
  draft_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, snapshot_id),
  foreign key (run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
create index cowork_draft_pending_queue on public.cowork_draft_requests(status, created_at)
  where status in ('pending', 'executing');
alter table public.cowork_draft_requests enable row level security;
revoke all on public.cowork_draft_requests from anon, authenticated;
grant select on public.cowork_draft_requests to authenticated;
grant all on public.cowork_draft_requests to service_role;
create policy cowork_draft_private_read on public.cowork_draft_requests for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

create function public.cowork_request_draft(p_run_id uuid, p_user_id uuid, p_organization_id uuid, p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs; existing public.cowork_draft_requests;
begin
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = p_user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
      and u.email_confirmed_at is not null and m.organization_id = p_organization_id) then return null; end if;
  select * into r from public.cowork_runs
    where id = p_run_id and user_id = p_user_id and organization_id = p_organization_id for update;
  if not found or r.status = 'cancelled' then return null; end if;
  select * into existing from public.cowork_draft_requests
    where run_id = p_run_id and snapshot_id = p_snapshot_id for update;
  if found then
    if existing.status = 'completed' then return jsonb_build_object('status', 'completed', 'reused', true);
    elsif existing.status in ('pending', 'executing') then return jsonb_build_object('status', existing.status, 'reused', true);
    else
      update public.cowork_draft_requests set status = 'pending', started_at = null, draft_id = null, updated_at = now()
        where run_id = p_run_id and snapshot_id = p_snapshot_id;
      insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
        values (r.id, r.user_id, r.organization_id, 'draft.requested',
          jsonb_build_object('snapshotId', p_snapshot_id, 'retry', true));
      return jsonb_build_object('status', 'pending', 'reused', false);
    end if;
  end if;
  insert into public.cowork_draft_requests(run_id, user_id, organization_id, snapshot_id)
    values (p_run_id, p_user_id, p_organization_id, p_snapshot_id);
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    values (r.id, r.user_id, r.organization_id, 'draft.requested', jsonb_build_object('snapshotId', p_snapshot_id));
  return jsonb_build_object('status', 'pending', 'reused', false);
end;
$$;

create function public.cowork_take_draft(p_user_id uuid)
returns setof public.cowork_draft_requests language plpgsql security definer set search_path = '' as $$
declare job public.cowork_runs; d public.cowork_draft_requests;
begin
  -- Requeue stale executions: native generation is idempotent, so a retry reuses the same draft.
  for job in select r.* from public.cowork_runs r
    where r.user_id = p_user_id and exists (select 1 from public.cowork_draft_requests q
      where q.run_id = r.id and q.status = 'executing'
        and (q.started_at is null or q.started_at < now() - interval '180 seconds'))
    order by r.created_at limit 20 for update of r skip locked
  loop
    update public.cowork_draft_requests set status = 'pending', started_at = null, updated_at = now()
      where run_id = job.id and status = 'executing' and attempts < 3;
    update public.cowork_draft_requests set status = 'failed', updated_at = now()
      where run_id = job.id and status = 'executing' and attempts >= 3;
    -- Only mark the run failed when the run itself is still active; draft retries must not revive it.
    if found and job.status in ('queued', 'running', 'waiting_approval') then
      update public.cowork_runs set status = 'failed', updated_at = now() where id = job.id;
      insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
        values (job.id, job.user_id, job.organization_id, 'draft.failed',
          '{"message":"La preparación del borrador se interrumpió varias veces. Solicítalo de nuevo desde el informe."}'::jsonb);
    end if;
  end loop;
  select r.* into job from public.cowork_runs r
    where r.user_id = p_user_id and r.status <> 'cancelled'
      and exists (select 1 from public.cowork_draft_requests q where q.run_id = r.id and q.status = 'pending')
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        join public.organization_members m on m.user_id = u.id
        where g.user_id = r.user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
          and u.email_confirmed_at is not null and m.organization_id = r.organization_id)
    order by r.created_at limit 1 for update of r skip locked;
  if not found then return; end if;
  update public.cowork_draft_requests set status = 'executing', started_at = now(),
      attempts = attempts + 1, updated_at = now()
    where ctid in (select ctid from public.cowork_draft_requests
      where run_id = job.id and status = 'pending' order by created_at limit 1)
    returning * into d;
  if not found then return; end if;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    values (job.id, job.user_id, job.organization_id, 'draft.started',
      jsonb_build_object('snapshotId', d.snapshot_id));
  return next d;
end;
$$;

create function public.cowork_finish_draft(p_run_id uuid, p_snapshot_id uuid, p_user_id uuid,
  p_organization_id uuid, p_success boolean, p_draft_id text, p_subject text, p_text text, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs;
begin
  select * into r from public.cowork_runs
    where id = p_run_id and user_id = p_user_id and organization_id = p_organization_id for update;
  if not found then return false; end if;
  update public.cowork_draft_requests set
      status = case when p_success then 'completed' else 'failed' end,
      draft_id = case when p_success then p_draft_id else null end,
      updated_at = now()
    where run_id = p_run_id and snapshot_id = p_snapshot_id and status = 'executing';
  if not found then return false; end if;
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = r.user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
      and u.email_confirmed_at is not null and m.organization_id = r.organization_id) then return false; end if;
  -- Never revive a cancelled run with a late draft result.
  if r.status = 'cancelled' then return false; end if;
  if p_success then
    insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
      values (r.id, r.user_id, r.organization_id, 'draft.completed',
        jsonb_build_object('snapshotId', p_snapshot_id, 'draftId', p_draft_id,
          'subject', p_subject, 'text', p_text));
  else
    insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
      values (r.id, r.user_id, r.organization_id, 'draft.failed',
        jsonb_build_object('snapshotId', p_snapshot_id, 'message', p_error));
  end if;
  return true;
end;
$$;
revoke all on function public.cowork_request_draft(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cowork_take_draft(uuid) from public, anon, authenticated;
revoke all on function public.cowork_finish_draft(uuid, uuid, uuid, uuid, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.cowork_request_draft(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.cowork_take_draft(uuid) to service_role;
grant execute on function public.cowork_finish_draft(uuid, uuid, uuid, uuid, boolean, text, text, text, text) to service_role;
