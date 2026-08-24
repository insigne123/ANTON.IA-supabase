-- Reserve enrichment quota once per trusted organization/user/resource/operation identity.

create table if not exists public.antonia_quota_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null,
  operation_id text not null,
  request_fingerprint text not null,
  requested_count integer not null,
  quota_scope text not null,
  quota_day date not null,
  quota_allowed boolean not null default false,
  quota_count_after integer not null default 0,
  quota_limit integer not null,
  consumed_count integer not null default 0,
  status text not null,
  claim_token uuid,
  claimed_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  response_status integer,
  response_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint antonia_quota_operations_resource_check check (resource in ('enrich', 'investigate')),
  constraint antonia_quota_operations_operation_id_check check (length(trim(operation_id)) between 1 and 200),
  constraint antonia_quota_operations_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint antonia_quota_operations_requested_count_check check (requested_count > 0),
  constraint antonia_quota_operations_scope_check check (quota_scope in ('organization', 'user')),
  constraint antonia_quota_operations_counts_check check (
    quota_count_after >= 0 and quota_limit >= 0 and consumed_count >= 0 and consumed_count <= requested_count
  ),
  constraint antonia_quota_operations_status_check check (status in ('claimed', 'submitted', 'completed', 'failed')),
  constraint antonia_quota_operations_state_check check (
    (status in ('claimed', 'submitted') and claim_token is not null and claimed_at is not null
      and response_status is null and response_payload is null and completed_at is null)
    or (status in ('completed', 'failed') and claim_token is null and response_status between 100 and 599
      and response_payload is not null and jsonb_typeof(response_payload) = 'object' and completed_at is not null)
  ),
  unique (organization_id, user_id, resource, operation_id)
);

create index if not exists antonia_quota_operations_created_idx
  on public.antonia_quota_operations (created_at);

alter table public.antonia_quota_operations enable row level security;
revoke all on table public.antonia_quota_operations from public, anon, authenticated;
grant select on table public.antonia_quota_operations to service_role;

create or replace function public.claim_antonia_quota_operation_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_scope text,
  p_resource text,
  p_operation_id text,
  p_request_fingerprint text,
  p_requested_count integer,
  p_limit integer,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_day date := timezone('utc', now())::date;
  v_operation public.antonia_quota_operations%rowtype;
  v_quota jsonb;
  v_claim_token uuid := gen_random_uuid();
  v_created boolean := false;
  v_claimed boolean := false;
  v_reused boolean := false;
  v_row_count integer := 0;
  v_allowed boolean := false;
  v_count integer := 0;
  v_limit integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null
    or p_scope not in ('organization', 'user')
    or p_resource not in ('enrich', 'investigate')
    or nullif(trim(coalesce(p_operation_id, '')), '') is null
    or length(trim(p_operation_id)) > 200
    or coalesce(lower(trim(p_request_fingerprint)), '') !~ '^[0-9a-f]{64}$'
    or p_requested_count is null or p_requested_count <= 0
    or p_limit is null or p_limit < 0
    or p_stale_after_seconds is null or p_stale_after_seconds < 60 then
    raise exception 'invalid quota operation claim input' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = p_user_id
  ) then
    raise exception 'quota operation user does not belong to organization' using errcode = '22023';
  end if;

  insert into public.antonia_quota_operations (
    organization_id, user_id, resource, operation_id, request_fingerprint,
    requested_count, quota_scope, quota_day, quota_limit, status,
    claim_token, claimed_at, created_at, updated_at
  ) values (
    p_organization_id, p_user_id, p_resource, trim(p_operation_id), lower(trim(p_request_fingerprint)),
    p_requested_count, p_scope, v_day, p_limit, 'claimed',
    v_claim_token, now(), now(), now()
  ) on conflict (organization_id, user_id, resource, operation_id) do nothing;
  get diagnostics v_row_count = row_count;
  v_created := v_row_count = 1;

  select quota_operation.*
  into v_operation
  from public.antonia_quota_operations quota_operation
  where quota_operation.organization_id = p_organization_id
    and quota_operation.user_id = p_user_id
    and quota_operation.resource = p_resource
    and quota_operation.operation_id = trim(p_operation_id)
  for update;
  if not found then
    raise exception 'quota operation claim was not persisted' using errcode = '55000';
  end if;
  if v_operation.request_fingerprint <> lower(trim(p_request_fingerprint))
    or v_operation.requested_count <> p_requested_count then
    raise exception 'operation id was already used for a different enrichment request' using errcode = '22023';
  end if;
  if v_operation.quota_allowed and v_operation.quota_scope <> p_scope then
    raise exception 'quota operation scope changed after consumption' using errcode = '22023';
  end if;

  if not v_created then
    if v_operation.status = 'failed'
      and not v_operation.quota_allowed
      and v_operation.response_status = 429
      and (
        v_operation.quota_day < v_day
        or v_operation.quota_scope <> p_scope
        or v_operation.quota_limit <> p_limit
      ) then
      v_claim_token := gen_random_uuid();
      update public.antonia_quota_operations
      set quota_scope = p_scope, quota_day = v_day, quota_count_after = 0, quota_limit = p_limit,
          status = 'claimed', claim_token = v_claim_token, claimed_at = now(), submitted_at = null,
          completed_at = null, response_status = null, response_payload = null, updated_at = now()
      where id = v_operation.id
      returning * into v_operation;
      v_created := true;
      v_reused := true;
    elsif v_operation.status = 'claimed'
      and v_operation.claimed_at < now() - make_interval(secs => p_stale_after_seconds) then
      v_claim_token := gen_random_uuid();
      update public.antonia_quota_operations
      set claim_token = v_claim_token, claimed_at = now(), updated_at = now()
      where id = v_operation.id
      returning * into v_operation;
      v_claimed := true;
      v_reused := true;
    else
      v_claim_token := null;
    end if;

    if not v_created then
      return jsonb_build_object(
        'allowed', v_operation.quota_allowed,
        'claimed', v_claimed,
        'reused', true,
        'status', v_operation.status,
        'claim_token', v_claim_token,
        'provider_state', case
          when v_operation.status = 'claimed' then 'not_started'
          when v_operation.status = 'submitted' and v_operation.submitted_at < now() - make_interval(secs => p_stale_after_seconds) then 'unknown'
          when v_operation.status = 'submitted' then 'processing'
          when v_operation.status = 'completed' then 'completed'
          else 'failed'
        end,
        'consumed', v_operation.consumed_count,
        'count', v_operation.quota_count_after,
        'limit', v_operation.quota_limit,
        'day_key', v_operation.quota_day,
        'response_status', v_operation.response_status,
        'response_payload', v_operation.response_payload
      );
    end if;
  end if;

  v_quota := public.consume_antonia_daily_quota_v1(
    p_organization_id, p_user_id, p_scope, p_resource, p_requested_count, p_limit
  );
  v_allowed := coalesce((v_quota ->> 'allowed')::boolean, false);
  v_count := coalesce((v_quota ->> 'count')::integer, 0);
  v_limit := coalesce((v_quota ->> 'limit')::integer, p_limit);

  if not v_allowed then
    update public.antonia_quota_operations
    set quota_allowed = false, quota_count_after = v_count, quota_limit = v_limit,
        consumed_count = 0, status = 'failed', claim_token = null, completed_at = now(),
        response_status = 429,
        response_payload = jsonb_build_object(
          'error', 'DAILY_ENRICHMENT_QUOTA_EXCEEDED', 'resource', p_resource,
          'count', v_count, 'limit', v_limit,
          'retryAt', ((v_day + 1)::timestamp at time zone 'UTC')
        ),
        updated_at = now()
    where id = v_operation.id
    returning * into v_operation;
  else
    update public.antonia_quota_operations
    set quota_allowed = true, quota_count_after = v_count, quota_limit = v_limit,
        consumed_count = p_requested_count, updated_at = now()
    where id = v_operation.id
    returning * into v_operation;
    v_claimed := true;
  end if;

  return jsonb_build_object(
    'allowed', v_operation.quota_allowed,
    'claimed', v_claimed,
    'reused', v_reused,
    'status', v_operation.status,
    'claim_token', case when v_claimed then v_operation.claim_token else null end,
    'provider_state', case when v_claimed then 'not_started' else 'failed' end,
    'consumed', v_operation.consumed_count,
    'count', v_operation.quota_count_after,
    'limit', v_operation.quota_limit,
    'day_key', v_operation.quota_day,
    'response_status', v_operation.response_status,
    'response_payload', v_operation.response_payload
  );
end;
$$;

create or replace function public.mark_antonia_quota_operation_submitted_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_resource text,
  p_operation_id text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.antonia_quota_operations
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where organization_id = p_organization_id and user_id = p_user_id
    and resource = p_resource and operation_id = trim(p_operation_id)
    and status = 'claimed' and claim_token = p_claim_token and quota_allowed;
  return found;
end;
$$;

create or replace function public.complete_antonia_quota_operation_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_resource text,
  p_operation_id text,
  p_claim_token uuid,
  p_status text,
  p_response_status integer,
  p_response_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed')
    or p_response_status not between 100 and 599
    or p_response_payload is null or jsonb_typeof(p_response_payload) <> 'object' then
    raise exception 'invalid quota operation completion input' using errcode = '22023';
  end if;
  update public.antonia_quota_operations
  set status = p_status, claim_token = null, completed_at = now(),
      response_status = p_response_status, response_payload = p_response_payload, updated_at = now()
  where organization_id = p_organization_id and user_id = p_user_id
    and resource = p_resource and operation_id = trim(p_operation_id)
    and status = 'submitted' and claim_token = p_claim_token and quota_allowed;
  return found;
end;
$$;

create or replace function public.release_antonia_quota_operation_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_resource text,
  p_operation_id text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_operation public.antonia_quota_operations%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.antonia_quota_operations
  where organization_id = p_organization_id and user_id = p_user_id
    and resource = p_resource and operation_id = trim(p_operation_id)
    and status = 'claimed' and claim_token = p_claim_token
  returning * into v_operation;
  if not found then
    return false;
  end if;
  if v_operation.quota_allowed and v_operation.consumed_count > 0 then
    if v_operation.quota_scope = 'user' then
      update public.antonia_user_daily_usage
      set usage_count = greatest(0, usage_count - v_operation.consumed_count), updated_at = now()
      where organization_id = v_operation.organization_id and user_id = v_operation.user_id
        and date = v_operation.quota_day and resource = v_operation.resource;
      if not found then
        raise exception 'user quota bucket is missing for operation release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage
      set leads_enriched = greatest(0, leads_enriched - case when v_operation.resource = 'enrich' then v_operation.consumed_count else 0 end),
          leads_investigated = greatest(0, leads_investigated - case when v_operation.resource = 'investigate' then v_operation.consumed_count else 0 end),
          updated_at = now()
      where organization_id = v_operation.organization_id and date = v_operation.quota_day;
      if not found then
        raise exception 'organization quota bucket is missing for operation release' using errcode = '55000';
      end if;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_antonia_quota_operation_v1(uuid, uuid, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.mark_antonia_quota_operation_submitted_v1(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_antonia_quota_operation_v1(uuid, uuid, text, text, uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.release_antonia_quota_operation_v1(uuid, uuid, text, text, uuid) from public, anon, authenticated;

grant execute on function public.claim_antonia_quota_operation_v1(uuid, uuid, text, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.mark_antonia_quota_operation_submitted_v1(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.complete_antonia_quota_operation_v1(uuid, uuid, text, text, uuid, text, integer, jsonb) to service_role;
grant execute on function public.release_antonia_quota_operation_v1(uuid, uuid, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
