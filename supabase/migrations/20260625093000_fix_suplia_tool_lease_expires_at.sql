-- Fix ambiguous expires_at references in SUPL.IA lease claiming RPC.

create or replace function public.claim_suplia_tool_lease(
  p_organization_id uuid,
  p_resource_key text,
  p_max_concurrent integer,
  p_ttl_seconds integer,
  p_job_id uuid default null,
  p_step_id uuid default null,
  p_tool_run_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(acquired boolean, lease_id uuid, lease_token text, active_count integer, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count integer;
  v_lease_id uuid;
  v_lease_token text;
  v_expires_at timestamptz;
  v_lock_key bigint;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if coalesce(trim(p_resource_key), '') = '' then
    raise exception 'resource_key is required';
  end if;

  v_lock_key := hashtextextended(p_organization_id::text || ':' || p_resource_key, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  update public.suplia_tool_leases as l
    set released_at = now()
    where l.organization_id = p_organization_id
      and l.resource_key = p_resource_key
      and l.released_at is null
      and l.expires_at <= now();

  select count(*) into v_active_count
  from public.suplia_tool_leases as l
  where l.organization_id = p_organization_id
    and l.resource_key = p_resource_key
    and l.released_at is null
    and l.expires_at > now();

  if v_active_count >= greatest(1, p_max_concurrent) then
    return query select false, null::uuid, null::text, v_active_count, null::timestamptz;
    return;
  end if;

  v_lease_token := gen_random_uuid()::text;
  v_expires_at := now() + make_interval(secs => greatest(15, p_ttl_seconds));

  insert into public.suplia_tool_leases(
    organization_id,
    resource_key,
    job_id,
    step_id,
    tool_run_id,
    lease_token,
    max_concurrent,
    expires_at,
    metadata
  ) values (
    p_organization_id,
    p_resource_key,
    p_job_id,
    p_step_id,
    p_tool_run_id,
    v_lease_token,
    greatest(1, p_max_concurrent),
    v_expires_at,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_lease_id;

  return query select true, v_lease_id, v_lease_token, v_active_count + 1, v_expires_at;
end;
$$;

notify pgrst, 'reload config';
