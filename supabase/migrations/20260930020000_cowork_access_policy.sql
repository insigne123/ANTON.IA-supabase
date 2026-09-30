-- M5 (plan 2): Cowork's access rule in one place, closed as it is today.
--
-- Until now every Cowork function wrote the owner's email into its own access check: 29 functions, each with
-- «lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'» next to the same conditions (an enabled grant in
-- cowork_access_grants, a confirmed email and membership in the organization). Opening Cowork to anyone
-- else meant editing all of them. This migration:
--   1. adds public.cowork_access_policy, one row with open_to_grants = false;
--   2. adds public.cowork_open_access(email): true for the owner's email, and for anyone once
--      open_to_grants is on;
--   3. re-creates those 29 functions exactly as they are in main, except that one comparison, which becomes
--      public.cowork_open_access(u.email). Every other condition stays: the grant, the confirmed email and
--      the membership are still required.
-- With open_to_grants off (the default) nothing changes: only the owner passes. To open Cowork, the owner
-- turns it on with the service role and gives each person a grant; the app keeps its own owner check
-- (COWORK_OWNER_USER_ID and COWORK_OWNER_EMAIL) until its own PR. Forward-only; one statement per function.

create table public.cowork_access_policy (
  singleton boolean primary key default true check (singleton),
  open_to_grants boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.cowork_access_policy (singleton, open_to_grants) values (true, false);
alter table public.cowork_access_policy enable row level security;
revoke all on public.cowork_access_policy from public, anon, authenticated;
grant all on public.cowork_access_policy to service_role;

-- The only place that names the owner. Called from the functions below (all security definer).
create function public.cowork_open_access(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(trim(coalesce(p_email, ''))) = 'nicolas.yarur.g@yago.cl'
    or coalesce((select p.open_to_grants from public.cowork_access_policy p where p.singleton), false);
$$;
revoke all on function public.cowork_open_access(text) from public, anon, authenticated;
grant execute on function public.cowork_open_access(text) to service_role;

-- The functions, as they are in main, with the owner's email replaced by public.cowork_open_access(u.email).
-- «create or replace» keeps each function's owner and privileges.

-- cowork_admit_run(uuid,uuid,uuid,text,text): as in 20260915154310_cowork_private_core.sql.
create or replace function public.cowork_admit_run(
  p_user_id uuid, p_organization_id uuid, p_request_id uuid, p_message text, p_mode text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid;
begin
  if not exists (
    select 1 from public.cowork_access_grants g
    join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = p_user_id and g.enabled
      and public.cowork_open_access(u.email)
      and u.email_confirmed_at is not null and m.organization_id = p_organization_id
  ) then raise exception 'Cowork access denied' using errcode = '42501'; end if;

  insert into public.cowork_runs(user_id, organization_id, request_id, message, mode)
    values (p_user_id, p_organization_id, p_request_id, p_message, p_mode)
    on conflict (user_id, organization_id, request_id) do nothing returning id into result_id;
  if result_id is not null then
    insert into public.cowork_run_events(run_id, user_id, organization_id, kind)
      values (result_id, p_user_id, p_organization_id, 'work.created');
  else
    select id into result_id from public.cowork_runs
      where user_id = p_user_id and organization_id = p_organization_id
        and request_id = p_request_id and message = p_message and mode = p_mode;
    if result_id is null then raise exception 'Idempotency conflict' using errcode = '22023'; end if;
  end if;
  return result_id;
end;
$$;

-- cowork_has_access(uuid): as in 20260915154310_cowork_private_core.sql.
create or replace function public.cowork_has_access(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cowork_access_grants g
    join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = auth.uid() and g.enabled
      and public.cowork_open_access(u.email)
      and u.email_confirmed_at is not null
      and m.organization_id = target_organization_id
  );
$$;

-- cowork_claim_run(uuid): as in 20260915154406_cowork_worker_leases.sql.
create or replace function public.cowork_claim_run(p_user_id uuid)
returns setof public.cowork_runs language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  -- Exhausted leases are terminal; never leave them silently running forever.
  with exhausted as (
    update public.cowork_runs set status = 'failed', lease_token = null,
      lease_expires_at = null, updated_at = now()
    where user_id = p_user_id and status = 'running' and lease_expires_at < now() and attempts >= 3
    returning id, user_id, organization_id
  ) insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    select id, user_id, organization_id, 'run.failed', '{"message":"El trabajo se interrumpió varias veces. Crea un nuevo trabajo para intentarlo otra vez."}'::jsonb from exhausted;

  select r.* into candidate from public.cowork_runs r
    join public.cowork_access_grants g on g.user_id = r.user_id and g.enabled
    join auth.users u on u.id = r.user_id
    where r.user_id = p_user_id and public.cowork_open_access(u.email)
      and u.email_confirmed_at is not null
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id)
      and (r.status = 'queued' or (r.status = 'running' and r.lease_expires_at < now() and r.attempts < 3))
    order by r.created_at limit 1 for update of r skip locked;
  if not found then return; end if;
  update public.cowork_runs set status = 'running', lease_token = gen_random_uuid(),
    lease_expires_at = now() + interval '180 seconds', attempts = attempts + 1, updated_at = now()
    where id = candidate.id returning * into candidate;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind)
    values (candidate.id, candidate.user_id, candidate.organization_id, 'run.started');
  return next candidate;
end;
$$;

-- cowork_finish_run_legacy(uuid,uuid,text,jsonb): as in 20260915154406_cowork_worker_leases.sql, where it was cowork_finish_run (renamed in 20260916163146_cowork_document_versions.sql).
create or replace function public.cowork_finish_run_legacy(p_run_id uuid, p_token uuid, p_status text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  if p_status not in ('completed', 'failed') then raise exception 'Invalid terminal status'; end if;
  update public.cowork_runs r set status = p_status, lease_token = null,
    lease_expires_at = null, updated_at = now()
    where r.id = p_run_id and r.status = 'running' and r.lease_token = p_token and r.lease_expires_at > now()
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = r.user_id and g.enabled and public.cowork_open_access(u.email)
          and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id)
    returning r.* into candidate;
  if not found then return false; end if;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    values (candidate.id, candidate.user_id, candidate.organization_id, 'run.' || p_status, p_payload);
  return true;
end;
$$;

-- cowork_record_tool_result(uuid,uuid,jsonb): as in 20260915154432_cowork_tool_events.sql.
create or replace function public.cowork_record_tool_result(p_run_id uuid, p_token uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  select r.* into candidate from public.cowork_runs r
    where r.id = p_run_id and r.status = 'running' and r.lease_token = p_token and r.lease_expires_at > now()
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id)
    for update of r;
  if not found then return false; end if;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    values (candidate.id, candidate.user_id, candidate.organization_id, 'tool.completed', p_payload);
  return true;
end;
$$;

-- cowork_propose_note(uuid,uuid,uuid,text): as in 20260915154603_cowork_note_approvals.sql.
create or replace function public.cowork_propose_note(p_run_id uuid, p_token uuid, p_lead_id uuid, p_note text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs; old_note text; target_id text; target_name text;
begin
  select * into r from public.cowork_runs where id = p_run_id and status = 'running'
    and lease_token = p_token and lease_expires_at > now() for update;
  if not found then return false; end if;
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = r.user_id and g.enabled and public.cowork_open_access(u.email)
    and u.email_confirmed_at is not null and m.organization_id = r.organization_id) then return false; end if;
  select name into target_name from public.leads where id::text = p_lead_id::text and user_id = r.user_id and organization_id = r.organization_id;
  if not found then raise exception 'Contact unavailable' using errcode = '42501'; end if;
  target_id := 'lead_saved|' || p_lead_id::text;
  select notes into old_note from public.unified_crm_data where id = target_id and organization_id = r.organization_id for update;
  -- First release only edits an existing saved-contact CRM entry.
  if not found then raise exception 'CRM entry unavailable' using errcode = '22023'; end if;
  insert into public.cowork_note_proposals(run_id,user_id,organization_id,lead_id,crm_id,previous_note,proposed_note)
    values(r.id,r.user_id,r.organization_id,p_lead_id,target_id,old_note,p_note);
  update public.cowork_runs set status = 'waiting_approval',lease_token = null,lease_expires_at = null,updated_at = now() where id = r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',jsonb_build_object('action','crm.replace_note','leadId',p_lead_id,'leadName',target_name,'previousNote',old_note,'proposedNote',p_note));
  return true;
end;
$$;

-- cowork_resolve_note(uuid,uuid,uuid,boolean): as in 20260915154603_cowork_note_approvals.sql.
create or replace function public.cowork_resolve_note(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs; p public.cowork_note_proposals; current_note text;
begin
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = p_user_id and g.enabled and public.cowork_open_access(u.email)
    and u.email_confirmed_at is not null and m.organization_id = p_organization_id) then return false; end if;
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  select * into p from public.cowork_note_proposals where run_id=r.id for update;
  if not found then return false; end if;
  if p.status='applied' then return p_approve; end if;
  if p.status='rejected' then return not p_approve; end if;
  if r.status <> 'waiting_approval' then return false; end if;
  if p_approve then
    perform 1 from public.leads where id::text=p.lead_id::text and user_id=p_user_id and organization_id=p_organization_id for share;
    if not found then return false; end if;
    select notes into current_note from public.unified_crm_data where id=p.crm_id and organization_id=p_organization_id for update;
    if not found or current_note is distinct from p.previous_note then raise exception 'Note changed; create a new proposal' using errcode='40001'; end if;
    update public.unified_crm_data set notes=p.proposed_note,updated_at=now() where id=p.crm_id and organization_id=p_organization_id;
  end if;
  update public.cowork_note_proposals set status=case when p_approve then 'applied' else 'rejected' end where run_id=r.id;
  update public.cowork_runs set status='completed',updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'run.completed',jsonb_build_object('reply',case when p_approve then 'Nota comercial actualizada en el CRM.' else 'Cambio descartado. La nota no se modificó.' end,'document',null,'action','crm.replace_note','applied',p_approve));
  return true;
end;
$$;

-- cowork_propose_search(uuid,uuid,jsonb): as in 20260916004748_cowork_external_search.sql.
create or replace function public.cowork_propose_search(p_run_id uuid,p_token uuid,p_criteria jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  select * into r from public.cowork_runs where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  insert into public.cowork_search_proposals(run_id,user_id,organization_id,criteria) values(r.id,r.user_id,r.organization_id,p_criteria);
  update public.cowork_runs set status='waiting_approval',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',jsonb_build_object('action','prospecting.search','criteria',p_criteria));
  return true;
end; $$;

-- cowork_claim_search(uuid,uuid,uuid,boolean): as in 20260916004808_cowork_search_queue.sql.
create or replace function public.cowork_claim_search(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_search_proposals;
begin
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then return null; end if;
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

-- cowork_take_search(uuid): as in 20260916004808_cowork_search_queue.sql.
create or replace function public.cowork_take_search(p_user_id uuid)
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
        where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r.organization_id)
    order by r.created_at limit 1 for update of r skip locked;
  if not found then return; end if;
  update public.cowork_search_proposals set status='executing',started_at=now() where run_id=job.id and status='approved' returning * into p;
  if not found then return; end if;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(job.id,job.user_id,job.organization_id,'search.started','{}'::jsonb);
  return next p;
end; $$;

-- cowork_finish_draft_legacy(uuid,uuid,uuid,uuid,boolean,text,text,text,text): as in 20260916004858_cowork_draft_queue.sql, where it was cowork_finish_draft (renamed in 20260916161140_cowork_draft_attempt_fencing.sql).
create or replace function public.cowork_finish_draft_legacy(p_run_id uuid, p_snapshot_id uuid, p_user_id uuid,
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
    where g.user_id = r.user_id and g.enabled and public.cowork_open_access(u.email)
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

-- cowork_request_draft(uuid,uuid,uuid,uuid): as in 20260916004858_cowork_draft_queue.sql.
create or replace function public.cowork_request_draft(p_run_id uuid, p_user_id uuid, p_organization_id uuid, p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.cowork_runs; existing public.cowork_draft_requests;
begin
  if not exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id
    where g.user_id = p_user_id and g.enabled and public.cowork_open_access(u.email)
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

-- cowork_finish_draft(uuid,uuid,uuid,uuid,integer,boolean,text,text,text,text): as in 20260916161140_cowork_draft_attempt_fencing.sql.
create or replace function public.cowork_finish_draft(p_run_id uuid,p_snapshot_id uuid,p_user_id uuid,
  p_organization_id uuid,p_attempt integer,p_success boolean,p_draft_id text,p_subject text,p_text text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=p_user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=p_organization_id) then return false; end if;
  perform 1 from public.cowork_draft_requests where run_id=p_run_id and snapshot_id=p_snapshot_id
    and user_id=p_user_id and organization_id=p_organization_id and status='executing'
    and attempts=p_attempt for update;
  if not found then return false; end if;
  return public.cowork_finish_draft_legacy(p_run_id,p_snapshot_id,p_user_id,p_organization_id,p_success,p_draft_id,p_subject,p_text,p_error);
end; $$;

-- cowork_take_draft(uuid): as in 20260916161140_cowork_draft_attempt_fencing.sql.
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
      and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r.organization_id)
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

-- cowork_finish_effect(uuid,uuid,uuid,boolean,text,jsonb): as in 20260917140000_cowork_effect_proposals.sql.
create or replace function public.cowork_finish_effect(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_success boolean,p_reply text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select * into r from public.cowork_runs where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id for update;
  if not found then return false; end if;
  select * into p from public.cowork_effect_proposals where run_id=r.id for update;
  if not found then return false; end if;
  if r.status<>'waiting_approval' or p.status<>'executing' then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
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

-- cowork_resolve_effect(uuid,uuid,uuid,boolean): as in 20260917140000_cowork_effect_proposals.sql.
create or replace function public.cowork_resolve_effect(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_approve boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=p_user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=p_organization_id) then return false; end if;
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

-- cowork_take_effect(uuid): as in 20260917140000_cowork_effect_proposals.sql.
create or replace function public.cowork_take_effect(p_user_id uuid)
returns setof public.cowork_effect_proposals language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; p public.cowork_effect_proposals;
begin
  select r2.* into r from public.cowork_runs r2
    where r2.user_id=p_user_id and r2.status='waiting_approval'
      and exists(select 1 from public.cowork_effect_proposals s where s.run_id=r2.id and s.status='approved')
      and exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
        where g.user_id=r2.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r2.organization_id)
    order by r2.created_at limit 1 for update of r2 skip locked;
  if not found then return; end if;
  update public.cowork_effect_proposals set status='executing',updated_at=now() where run_id=r.id and status='approved' returning * into p;
  if not found then return; end if;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'effect.started',jsonb_build_object('kind',p.kind,'label',p.label));
  return next p;
end; $$;

-- cowork_finish_search(uuid,uuid,uuid,boolean,jsonb): as in 20260918110000_cowork_search_quota_message.sql.
create or replace function public.cowork_finish_search(p_run_id uuid,p_user_id uuid,p_organization_id uuid,p_success boolean,p_payload jsonb)
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
    where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if p_success then
    insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload) values(r.id,r.user_id,r.organization_id,'tool.completed',p_payload);
  end if;
  update public.cowork_runs set status=case when p_success then 'completed' else 'failed' end,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,case when p_success then 'run.completed' else 'run.failed' end,
      case when p_success then jsonb_build_object('reply','Búsqueda terminada. Revisa los contactos encontrados; todavía no se han guardado en tu base.','document',null)
        when coalesce(p_payload->>'reason','')='quota_exhausted'
        then '{"message":"Se alcanzó el cupo diario de búsquedas externas. Se renueva mañana; mientras tanto puedes trabajar con tus contactos guardados o revisar borradores. No se consumió una búsqueda adicional."}'::jsonb
        else '{"message":"No pudimos confirmar el resultado de la búsqueda. No se reintentará automáticamente."}'::jsonb end);
  return true;
end; $$;

-- cowork_cancel_run(uuid,uuid,uuid): as in 20260920205105_cowork_specialist_queue.sql.
create or replace function public.cowork_cancel_run(p_user_id uuid,p_organization_id uuid,p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  update public.cowork_runs set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where id=p_run_id and user_id=p_user_id and organization_id=p_organization_id
      and status in ('queued','running','waiting_approval','waiting_workers')
      and exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
        where g.user_id=p_user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null)
      and exists(select 1 from public.organization_members m where m.user_id=p_user_id and m.organization_id=p_organization_id)
    returning * into r;
  if not found then return false; end if;
  update public.cowork_specialist_tasks set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
    where run_id=r.id and status in ('pending','executing');
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind) values(r.id,r.user_id,r.organization_id,'run.cancelled');
  return true;
end; $$;

-- cowork_enqueue_specialists(uuid,uuid,jsonb): as in 20260920205105_cowork_specialist_queue.sql.
create or replace function public.cowork_enqueue_specialists(p_run_id uuid,p_token uuid,p_assignments jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; item jsonb;
begin
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) not between 1 and 2
    or octet_length(p_assignments::text)>80000 then raise exception 'Invalid assignments'; end if;
  select * into r from public.cowork_runs where id=p_run_id for update;
  if not found or r.status<>'running' or p_token is null or r.lease_token is distinct from p_token
    or r.lease_expires_at is null or r.lease_expires_at<=now() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  if exists(select 1 from public.cowork_specialist_tasks where run_id=r.id) then
    raise exception 'Specialist budget already consumed';
  end if;
  for item in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(item->'task') is distinct from 'object'
      or jsonb_typeof(item->'evidence') is distinct from 'array'
      or jsonb_array_length(item->'evidence') not between 1 and 3
      or length(item->'task'->>'objective') not between 1 and 600
      or item->'task'->>'objective' is null then raise exception 'Invalid specialist assignment'; end if;
    insert into public.cowork_specialist_tasks(run_id,user_id,organization_id,role,assignment)
      values(r.id,r.user_id,r.organization_id,item->'task'->>'role',item);
  end loop;
  update public.cowork_runs set status='waiting_workers',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'specialists.queued',jsonb_build_object('count',jsonb_array_length(p_assignments)));
  return true;
end; $$;

-- cowork_finish_specialist(uuid,uuid,boolean,jsonb,jsonb,text): as in 20260920205105_cowork_specialist_queue.sql.
create or replace function public.cowork_finish_specialist(p_id uuid,p_token uuid,p_success boolean,p_result jsonb,p_usage jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; parent_id uuid;
begin
  if octet_length(coalesce(p_result,'null'::jsonb)::text)>20000 or octet_length(coalesce(p_usage,'null'::jsonb)::text)>4000 then
    raise exception 'Specialist output too large'; end if;
  select run_id into parent_id from public.cowork_specialist_tasks where id=p_id;
  if not found then return false; end if;
  select * into r from public.cowork_runs where id=parent_id for update;
  if not found or r.status<>'waiting_workers' then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_specialist_tasks set status=case when p_success then 'completed' else 'failed' end,
    result=case when p_success then p_result else null end,usage=p_usage,
    error_code=case when p_success then null else left(coalesce(p_error,'generation_failed'),100) end,updated_at=now()
    where id=p_id and lease_token=p_token and status='executing' and lease_expires_at>now();
  if not found then return false; end if;
  perform public.cowork_settle_specialists(r.id);
  return true;
end; $$;

-- cowork_take_specialist(uuid): as in 20260920205105_cowork_specialist_queue.sql.
create or replace function public.cowork_take_specialist(p_user_id uuid)
returns setof public.cowork_specialist_tasks language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; job public.cowork_specialist_tasks;
begin
  -- One parent lock serializes claim/finalization/cancellation consistently.
  for r in select runs.* from public.cowork_runs runs
    where runs.user_id=p_user_id and runs.status='waiting_workers'
    order by runs.created_at limit 20 for update skip locked loop
    if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
      join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
      and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
      and m.organization_id=r.organization_id) then
      update public.cowork_specialist_tasks set status='cancelled',lease_token=null,lease_expires_at=null,updated_at=now()
        where run_id=r.id and status in ('pending','executing');
      update public.cowork_runs set status='cancelled',updated_at=now() where id=r.id;
      insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
        values(r.id,r.user_id,r.organization_id,'run.cancelled','{"reason":"access_revoked"}'::jsonb);
      continue;
    end if;
    update public.cowork_specialist_tasks set status='uncertain',error_code='outcome_unknown',updated_at=now()
      where run_id=r.id and status='executing' and lease_expires_at<=now();
    if public.cowork_settle_specialists(r.id) then continue; end if;
    select * into job from public.cowork_specialist_tasks
      where run_id=r.id and status='pending' order by created_at,role limit 1 for update skip locked;
    if found then
      update public.cowork_specialist_tasks set status='executing',lease_token=gen_random_uuid(),
        lease_expires_at=now()+interval '60 seconds',updated_at=now() where id=job.id returning * into job;
      return next job; return;
    end if;
  end loop;
end; $$;

-- cowork_finish_operation_v2(uuid,uuid,uuid,boolean,jsonb,text): as in 20260921022101_cowork_specialist_read_leases.sql.
create or replace function public.cowork_finish_operation_v2(p_id uuid,p_lease uuid,p_run_lease uuid,
  p_success boolean,p_result jsonb,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; parent_id uuid; deadline timestamptz;
begin
  select run_id into parent_id from public.cowork_operations where id=p_id;
  if not found then return false; end if;
  select * into r from public.cowork_runs where id=parent_id for update;
  deadline:=public.cowork_attempt_deadline(parent_id,p_run_lease);
  if r.id is null or p_run_lease is null or deadline is null or deadline<=clock_timestamp() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  update public.cowork_operations set status=case when p_success then 'completed' else 'failed' end,
    result=case when p_success then coalesce(p_result,'null'::jsonb) else null end,
    error_code=case when p_success then null else left(coalesce(nullif(trim(p_error_code),''),'operation_failed'),100) end,
    updated_at=now() where id=p_id and run_id=r.id and user_id=r.user_id and organization_id=r.organization_id
      and lease_token=p_lease and run_attempt_token=p_run_lease and status='executing' and operation_expires_at>clock_timestamp();
  return found;
end; $$;

-- cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid): as in 20260921022101_cowork_specialist_read_leases.sql.
create or replace function public.cowork_reserve_operation_v2(
  p_user_id uuid,p_organization_id uuid,p_run_id uuid,p_capability text,p_version integer,
  p_input jsonb,p_input_hash text,p_lease uuid,p_run_lease uuid
) returns public.cowork_operations language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; op public.cowork_operations; retryable boolean; deadline timestamptz; task public.cowork_specialist_tasks;
begin
  select * into r from public.cowork_runs where id=p_run_id for update;
  deadline:=public.cowork_attempt_deadline(p_run_id,p_run_lease);
  if r.id is null or r.user_id<>p_user_id or r.organization_id<>p_organization_id
    or p_run_lease is null or deadline is null or deadline<=clock_timestamp() then
    raise exception 'Run attempt unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=p_user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=p_organization_id) then raise exception 'Access revoked' using errcode='42501'; end if;
  if p_lease is null or p_input_hash is null or length(p_input_hash)<>64 then
    raise exception 'Invalid reservation' using errcode='22023'; end if;
  retryable:=p_capability in ('leads.search','leads.get','research.get_existing','crm.search','crm.get_lead',
    'contacted.search','contacted.timeline','metrics.overview','app.context','draft.get','campaigns.list','files.list',
    'saved_searches.list','profile.get','missions.list','exceptions.list','campaigns.inbox','campaigns.plan',
    'campaigns.step_context','crm.collaboration','crm.record','privacy.contactability','privacy.contactability_batch','specialists.plan');
  if r.status='waiting_workers' then
    select * into task from public.cowork_specialist_tasks where run_id=r.id and lease_token=p_run_lease and status='executing';
    -- The immutable assignment authorizes exactly one tool and its exact input.
    if not retryable or task.id is null or task.assignment->'task'->'read'->>'action' is distinct from p_capability
      or task.assignment->'task'->'read'->'input' is distinct from p_input
      or not (case task.role
        when 'analyst' then p_capability in ('metrics.overview','crm.record')
        when 'researcher' then p_capability in ('research.get_existing','leads.get')
        when 'verifier' then p_capability in ('privacy.contactability','crm.collaboration')
        else false end) then raise exception 'Specialist tool unavailable' using errcode='42501'; end if;
  end if;
  insert into public.cowork_operations(user_id,organization_id,run_id,capability,version,input,input_hash,
    lease_token,status,attempts,operation_expires_at,run_attempt_token)
    values(p_user_id,p_organization_id,p_run_id,p_capability,p_version,coalesce(p_input,'null'::jsonb),p_input_hash,
      p_lease,'executing',1,least(clock_timestamp()+interval '120 seconds',deadline),p_run_lease)
    on conflict(user_id,organization_id,capability,version,input_hash) do nothing;
  select * into op from public.cowork_operations where user_id=p_user_id and organization_id=p_organization_id
    and capability=p_capability and version=p_version and input_hash=p_input_hash for update;
  if op.run_id<>p_run_id or op.input is distinct from coalesce(p_input,'null'::jsonb) then
    raise exception 'Reservation conflict' using errcode='22023'; end if;
  if op.status in ('completed','failed','cancelled') then return op; end if;
  if op.operation_expires_at is null then raise exception 'Legacy reservation unavailable' using errcode='55000'; end if;
  if op.operation_expires_at>clock_timestamp() and op.run_attempt_token=p_run_lease then return op; end if;
  if not retryable or op.attempts>=3 then
    update public.cowork_operations set status='failed',error_code=case when retryable then 'attempts_exhausted' else 'outcome_unknown' end,
      updated_at=now() where id=op.id returning * into op;
    return op;
  end if;
  update public.cowork_operations set status='executing',lease_token=p_lease,run_attempt_token=p_run_lease,
    attempts=attempts+1,operation_expires_at=least(clock_timestamp()+interval '120 seconds',deadline),updated_at=now()
    where id=op.id returning * into op;
  return op;
end; $$;

-- cowork_lead_collaboration_op(uuid,uuid,text,uuid,integer): as in 20260921133043_cowork_phase4_effects_3.sql.
create or replace function public.cowork_lead_collaboration_op(
  p_lead_id uuid, p_actor_user_id uuid, p_op text,
  p_assigned_to_user_id uuid default null, p_minutes integer default 15
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.organization_lead_collaboration%rowtype; v_role text;
begin
  if p_lead_id is null or p_actor_user_id is null
    or p_op is null or p_op not in ('assign','claim','release') then
    raise exception 'invalid collaboration operation' using errcode='22023'; end if;
  if p_op = 'assign' and p_assigned_to_user_id is null then
    raise exception 'invalid lead assignment' using errcode='22023'; end if;
  if p_op = 'claim' and (p_minutes is null or p_minutes not between 1 and 60) then
    raise exception 'invalid lead claim' using errcode='22023'; end if;
  select * into v_row from public.organization_lead_collaboration where lead_id=p_lead_id for update;
  if not found then raise exception 'Lead collaboration row not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.organizations o
    where o.id=v_row.organization_id and o.collaboration_v1_enabled) then
    raise exception 'Organization collaboration is not enabled' using errcode='55000'; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=p_actor_user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=v_row.organization_id) then raise exception 'Cowork access revoked' using errcode='42501'; end if;
  select om.role into v_role from public.organization_members om
    where om.organization_id=v_row.organization_id and om.user_id=p_actor_user_id;
  if v_role is null then raise exception 'not authorized' using errcode='42501'; end if;

  if p_op = 'assign' then
    if not exists(select 1 from public.organization_members om
      where om.organization_id=v_row.organization_id and om.user_id=p_assigned_to_user_id) then
      raise exception 'Assignee is not an organization member' using errcode='22023'; end if;
    if v_role = 'member' and (p_assigned_to_user_id <> p_actor_user_id
      or (v_row.assigned_to_user_id is not null and v_row.assigned_to_user_id <> p_actor_user_id)) then
      raise exception 'Members can only claim an unassigned lead for themselves' using errcode='42501'; end if;
    update public.organization_lead_collaboration
    set assigned_to_user_id=p_assigned_to_user_id, assigned_at=now(), assigned_by_user_id=p_actor_user_id,
      claimed_by_user_id=case when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id
        then null else claimed_by_user_id end,
      claim_expires_at=case when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id
        then null else claim_expires_at end,
      contact_state=case when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id
        and contact_state='reserved' then 'uncontacted' else contact_state end
    where lead_id=p_lead_id returning * into v_row;
    perform public.append_organization_collaboration_event_v1(
      v_row.organization_id, p_actor_user_id, 'lead.assigned', 'lead', p_lead_id::text,
      p_lead_id, null, jsonb_build_object('assignedToUserId', p_assigned_to_user_id));
    return to_jsonb(v_row);
  end if;

  if p_op = 'claim' then
    if v_row.claimed_by_user_id is not null and v_row.claimed_by_user_id <> p_actor_user_id
      and v_row.claim_expires_at > now() then
      raise exception 'Lead is already being prepared by another member' using errcode='55000'; end if;
    if v_role = 'member' and v_row.assigned_to_user_id is not null
      and v_row.assigned_to_user_id <> p_actor_user_id then
      raise exception 'Lead is assigned to another member' using errcode='42501'; end if;
    update public.organization_lead_collaboration
    set assigned_to_user_id=coalesce(assigned_to_user_id, p_actor_user_id),
      assigned_at=case when assigned_to_user_id is null then now() else assigned_at end,
      assigned_by_user_id=case when assigned_to_user_id is null then p_actor_user_id else assigned_by_user_id end,
      claimed_by_user_id=p_actor_user_id,
      claim_expires_at=now()+make_interval(mins=>p_minutes),
      contact_state=case when contact_state='uncontacted' then 'reserved' else contact_state end
    where lead_id=p_lead_id returning * into v_row;
    perform public.append_organization_collaboration_event_v1(
      v_row.organization_id, p_actor_user_id, 'lead.claimed', 'lead', p_lead_id::text,
      p_lead_id, null, jsonb_build_object('expiresAt', v_row.claim_expires_at));
    return to_jsonb(v_row);
  end if;

  if v_role is null or (v_row.claimed_by_user_id is distinct from p_actor_user_id
    and v_role not in ('owner','admin')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  update public.organization_lead_collaboration
  set claimed_by_user_id=null, claim_expires_at=null,
    contact_state=case when contact_state='reserved' then 'uncontacted' else contact_state end
  where lead_id=p_lead_id;
  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, p_actor_user_id, 'lead.claim_released', 'lead', p_lead_id::text,
    p_lead_id, null, '{}'::jsonb);
  return jsonb_build_object('released', true);
end; $$;

-- cowork_propose_effect(uuid,uuid,text,uuid,text,text): as in 20260922050000_cowork_linkedin_bridge.sql.
create or replace function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind is null or p_kind not in ('save_contact','start_research','request_draft','enrich_contact',
    'send_email','campaign_create','campaign_activate','campaign_pause','code_execute',
    'profile_update','saved_search_create','saved_search_update','saved_search_delete',
    'campaign_stop_v2','crm_update_record','campaign_prepare_draft_v2',
    'crm_assign_lead','exception_resolve','mission_control','message_context_update',
    'enrich_batch','campaign_schedule_batch','linkedin_invite','linkedin_message') then
    raise exception 'Unknown effect' using errcode='22023';
  end if;
  if p_target_id is null or length(trim(p_target_id)) = 0 or length(p_target_id) > 300 then raise exception 'Invalid target' using errcode='22023'; end if;
  if p_label is null or length(trim(p_label)) = 0 or length(p_label) > 280 then raise exception 'Invalid label' using errcode='22023'; end if;
  select * into r from public.cowork_runs where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if p_origin_run_id is null then raise exception 'Origin unavailable' using errcode='22023'; end if;
  if p_origin_run_id <> p_run_id then
    perform 1 from public.cowork_runs where id=p_origin_run_id and user_id=r.user_id and organization_id=r.organization_id and status='completed';
    if not found then raise exception 'Origin unavailable' using errcode='22023'; end if;
  end if;
  insert into public.cowork_effect_proposals(run_id,user_id,organization_id,kind,origin_run_id,target_id,label)
    values(r.id,r.user_id,r.organization_id,p_kind,p_origin_run_id,trim(p_target_id),trim(p_label));
  update public.cowork_runs set status='waiting_approval',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',
      jsonb_build_object('action','cowork.effect','kind',p_kind,'targetId',trim(p_target_id),'label',trim(p_label)));
  return true;
end; $$;

-- cowork_write_run_draft(uuid,uuid,text,jsonb): as in 20260928010000_cowork_run_drafts.sql.
create or replace function public.cowork_write_run_draft(p_run_id uuid, p_token uuid, p_text text, p_progress jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  if length(coalesce(p_text, '')) > 20000 then raise exception 'Cowork draft too long' using errcode = '22001'; end if;
  if p_progress is not null and (jsonb_typeof(p_progress) <> 'object' or pg_column_size(p_progress) > 4096) then
    raise exception 'Cowork draft progress invalid' using errcode = '22023';
  end if;
  select r.* into candidate from public.cowork_runs r
    where r.id = p_run_id and r.status = 'running' and r.lease_token = p_token and r.lease_expires_at > now()
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = r.user_id and g.enabled and public.cowork_open_access(u.email) and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id);
  if not found then return false; end if;
  insert into public.cowork_run_drafts(run_id, user_id, organization_id, text, progress, updated_at)
    values (candidate.id, candidate.user_id, candidate.organization_id, coalesce(p_text, ''), coalesce(p_progress, '{}'::jsonb), now())
    on conflict (run_id) do update set text = excluded.text, progress = excluded.progress, updated_at = excluded.updated_at;
  return true;
end;
$$;

-- cowork_record_model_usage(uuid,uuid,jsonb): as in 20260928030000_cowork_writer_reviewer_roles.sql.
create or replace function public.cowork_record_model_usage(p_id uuid,p_token uuid,p_usage jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.cowork_model_calls; r public.cowork_runs; parent_id uuid; deadline timestamptz;
begin
  if jsonb_typeof(p_usage) is distinct from 'object' or octet_length(p_usage::text)>4000 then
    raise exception 'Invalid usage'; end if;
  select run_id into parent_id from public.cowork_model_calls where id=p_id;
  if not found then return false; end if;
  select * into r from public.cowork_runs where id=parent_id for update;
  deadline:=public.cowork_attempt_deadline(parent_id,p_token);
  if deadline is null or deadline<=clock_timestamp() then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id
    join public.organization_members m on m.user_id=u.id where g.user_id=r.user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then return false; end if;
  select * into c from public.cowork_model_calls where id=p_id for update;
  if c.user_id<>r.user_id or c.organization_id<>r.organization_id then return false; end if;
  if c.role in ('coordinator','writer','reviewer','judge') and (r.status<>'running' or r.lease_token is distinct from p_token) then return false; end if;
  if c.role not in ('coordinator','writer','reviewer','judge') and not exists(select 1 from public.cowork_specialist_tasks
    where run_id=r.id and role=c.role and status='executing' and lease_token=p_token) then return false; end if;
  if c.usage_recorded_at is not null then return c.usage=p_usage; end if;
  update public.cowork_model_calls set usage=p_usage,usage_recorded_at=clock_timestamp() where id=c.id;
  return true;
end; $$;

-- cowork_reserve_model_call(uuid,uuid,text,uuid): as in 20260928030000_cowork_writer_reviewer_roles.sql.
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
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id=r.organization_id) then raise exception 'Model access revoked'; end if;
  if p_role in ('coordinator','writer','reviewer','judge') then
    -- In-turn roles: only the worker holding the run's live lease.
    if r.status<>'running' or r.lease_token is distinct from p_token or r.lease_expires_at<=clock_timestamp() or r.lease_expires_at is null
      then raise exception 'Model attempt expired'; end if;
    requested:=case when p_role in ('coordinator','writer') then 6000 else 1500 end;
  else
    if p_role is null or p_role not in ('analyst','researcher','verifier') or r.status<>'waiting_workers' or not exists(
      select 1 from public.cowork_specialist_tasks where id=p_task_id and run_id=r.id and role=p_role
        and status='executing' and lease_token=p_token and lease_expires_at>clock_timestamp())
      then raise exception 'Specialist attempt unavailable'; end if;
    requested:=1800;
  end if;
  select count(*),coalesce(sum(output_reserved),0),count(*) filter(where role=p_role)
    into calls,tokens,role_calls from public.cowork_model_calls where run_id=r.id;
  if calls>=11 or tokens+requested>55000
    or role_calls>=(case p_role when 'coordinator' then 5 when 'writer' then 2 else 1 end)
    then raise exception 'Model budget exhausted'; end if;
  with recursive conversation(id) as (
    select root_id
    union
    select child.id from public.cowork_runs child join conversation parent on child.parent_run_id=parent.id
      where child.user_id=r.user_id and child.organization_id=r.organization_id
  ) select count(*),coalesce(sum(c.output_reserved),0) into calls,tokens
    from public.cowork_model_calls c join conversation t on t.id=c.run_id;
  if calls>=40 or tokens+requested>180000 then raise exception 'Model budget exhausted'; end if;
  insert into public.cowork_model_calls(run_id,user_id,organization_id,role,output_reserved)
    values(r.id,r.user_id,r.organization_id,p_role,requested) returning id into admitted;
  return admitted;
end; $$;
