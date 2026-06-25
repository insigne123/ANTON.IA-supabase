-- SUPL.IA provider/tool leases for cross-worker concurrency limits

create extension if not exists pgcrypto;

alter table public.suplia_tool_runs
  add column if not exists token_usage jsonb;

create table if not exists public.suplia_tool_leases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  resource_key text not null,
  job_id uuid references public.suplia_jobs(id) on delete cascade,
  step_id uuid references public.suplia_job_steps(id) on delete set null,
  tool_run_id uuid references public.suplia_tool_runs(id) on delete set null,
  lease_token text not null unique,
  max_concurrent integer not null default 1,
  expires_at timestamptz not null,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.suplia_tool_leases
  drop constraint if exists suplia_tool_leases_max_concurrent_check,
  add constraint suplia_tool_leases_max_concurrent_check check (max_concurrent >= 1);

create index if not exists suplia_tool_leases_active_idx
  on public.suplia_tool_leases(organization_id, resource_key, expires_at)
  where released_at is null;

create index if not exists suplia_tool_leases_job_idx
  on public.suplia_tool_leases(job_id, created_at desc);

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

  update public.suplia_tool_leases
    set released_at = now()
    where organization_id = p_organization_id
      and resource_key = p_resource_key
      and released_at is null
      and expires_at <= now();

  select count(*) into v_active_count
  from public.suplia_tool_leases
  where organization_id = p_organization_id
    and resource_key = p_resource_key
    and released_at is null
    and expires_at > now();

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

create or replace function public.release_suplia_tool_lease(p_lease_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.suplia_tool_leases
    set released_at = now()
    where lease_token = p_lease_token
      and released_at is null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

alter table public.suplia_tool_leases enable row level security;

drop policy if exists "Org members can view SUPLIA tool leases" on public.suplia_tool_leases;
create policy "Org members can view SUPLIA tool leases" on public.suplia_tool_leases for select
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_tool_leases.organization_id and om.user_id = auth.uid()));

drop policy if exists "Org members can manage SUPLIA tool leases" on public.suplia_tool_leases;
create policy "Org members can manage SUPLIA tool leases" on public.suplia_tool_leases for all
  using (exists (select 1 from public.organization_members om where om.organization_id = suplia_tool_leases.organization_id and om.user_id = auth.uid()))
  with check (exists (select 1 from public.organization_members om where om.organization_id = suplia_tool_leases.organization_id and om.user_id = auth.uid()));

notify pgrst, 'reload config';
