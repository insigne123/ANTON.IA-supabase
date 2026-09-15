-- Applied after the private core; version aligned with production ledger.
alter table public.cowork_runs
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column attempts integer not null default 0;

create function public.cowork_claim_run(p_user_id uuid)
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
    where r.user_id = p_user_id and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
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

create function public.cowork_finish_run(p_run_id uuid, p_token uuid, p_status text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  if p_status not in ('completed', 'failed') then raise exception 'Invalid terminal status'; end if;
  update public.cowork_runs r set status = p_status, lease_token = null,
    lease_expires_at = null, updated_at = now()
    where r.id = p_run_id and r.status = 'running' and r.lease_token = p_token and r.lease_expires_at > now()
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = r.user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl'
          and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = r.user_id and m.organization_id = r.organization_id)
    returning r.* into candidate;
  if not found then return false; end if;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind, payload)
    values (candidate.id, candidate.user_id, candidate.organization_id, 'run.' || p_status, p_payload);
  return true;
end;
$$;

create function public.cowork_cancel_run(p_user_id uuid, p_organization_id uuid, p_run_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare candidate public.cowork_runs;
begin
  update public.cowork_runs r set status = 'cancelled', lease_token = null,
    lease_expires_at = null, updated_at = now()
    where id = p_run_id and user_id = p_user_id and organization_id = p_organization_id
      and status in ('queued', 'running', 'waiting_approval')
      and exists (select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
        where g.user_id = p_user_id and g.enabled and lower(trim(u.email)) = 'nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null)
      and exists (select 1 from public.organization_members m where m.user_id = p_user_id and m.organization_id = p_organization_id)
    returning r.* into candidate;
  if not found then return false; end if;
  insert into public.cowork_run_events(run_id, user_id, organization_id, kind)
    values (candidate.id, candidate.user_id, candidate.organization_id, 'run.cancelled');
  return true;
end;
$$;

revoke all on function public.cowork_claim_run(uuid) from public, anon, authenticated;
revoke all on function public.cowork_finish_run(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.cowork_cancel_run(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cowork_claim_run(uuid) to service_role;
grant execute on function public.cowork_finish_run(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.cowork_cancel_run(uuid, uuid, uuid) to service_role;
