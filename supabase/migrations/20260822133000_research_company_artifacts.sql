-- Phase 3 company-research artifacts are tenant-scoped, versioned, and leased
-- so concurrent workers cannot repeat the same company research work.

create extension if not exists pgcrypto;

create table public.research_company_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cache_identity text not null,
  company_identity text not null,
  country_code text not null,
  research_depth text not null,
  research_language text not null,
  profile_revision text not null,
  icp_hash text not null,
  prompt_version text not null,
  provider text not null,
  provider_version text not null,
  revision integer not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  generation_claim_token uuid,
  generation_claimed_at timestamptz,
  generation_claim_expires_at timestamptz,
  error_code text,
  error_message text,
  error_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint research_company_artifacts_cache_identity_check
    check (cache_identity ~ '^[a-f0-9]{64}$'),
  constraint research_company_artifacts_company_identity_check
    check (length(trim(company_identity)) between 1 and 500),
  constraint research_company_artifacts_country_code_check
    check (length(trim(country_code)) between 1 and 64),
  constraint research_company_artifacts_depth_check
    check (research_depth in ('basic', 'standard', 'deep')),
  constraint research_company_artifacts_language_check
    check (length(trim(research_language)) between 2 and 24),
  constraint research_company_artifacts_profile_revision_check
    check (length(trim(profile_revision)) between 1 and 160),
  constraint research_company_artifacts_icp_hash_check
    check (length(trim(icp_hash)) between 1 and 160),
  constraint research_company_artifacts_prompt_version_check
    check (length(trim(prompt_version)) between 1 and 160),
  constraint research_company_artifacts_provider_check
    check (length(trim(provider)) between 1 and 160),
  constraint research_company_artifacts_provider_version_check
    check (length(trim(provider_version)) between 1 and 160),
  constraint research_company_artifacts_revision_check
    check (revision >= 1),
  constraint research_company_artifacts_status_check
    check (status in ('queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled')),
  constraint research_company_artifacts_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint research_company_artifacts_error_metadata_check
    check (jsonb_typeof(error_metadata) = 'object'),
  constraint research_company_artifacts_generation_lease_check
    check (
      (status = 'running'
        and generation_claim_token is not null
        and generation_claimed_at is not null
        and generation_claim_expires_at is not null
        and generation_claim_expires_at > generation_claimed_at)
      or
      (status <> 'running'
        and generation_claim_token is null
        and generation_claimed_at is null
        and generation_claim_expires_at is null)
    ),
  constraint research_company_artifacts_terminal_state_check
    check (
      (status in ('completed', 'partial', 'insufficient_data', 'failed', 'cancelled') and completed_at is not null)
      or (status in ('queued', 'running') and completed_at is null)
    ),
  unique (organization_id, cache_identity, revision)
);

create index research_company_artifacts_identity_lookup_idx
  on public.research_company_artifacts(organization_id, cache_identity, revision desc);

create index research_company_artifacts_fresh_lookup_idx
  on public.research_company_artifacts(organization_id, cache_identity, expires_at desc)
  where status in ('completed', 'partial', 'insufficient_data');

create index research_company_artifacts_expiry_idx
  on public.research_company_artifacts(expires_at)
  where status in ('completed', 'partial', 'insufficient_data');

alter table public.research_company_artifacts enable row level security;

revoke all on table public.research_company_artifacts from public, anon, authenticated;
grant select on table public.research_company_artifacts to authenticated;
grant all on table public.research_company_artifacts to service_role;

create policy "Tenant members can read research company artifacts"
  on public.research_company_artifacts
  for select
  to authenticated
  using (public.is_current_user_organization_member(organization_id));

create or replace function public.claim_research_company_artifact_v1(
  p_organization_id uuid,
  p_cache_identity text,
  p_company_identity text,
  p_country_code text,
  p_research_depth text,
  p_research_language text,
  p_profile_revision text,
  p_icp_hash text,
  p_prompt_version text,
  p_provider text,
  p_provider_version text,
  p_force_refresh boolean default false,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_artifact public.research_company_artifacts%rowtype;
  v_cached_artifact public.research_company_artifacts%rowtype;
  v_identity_artifact public.research_company_artifacts%rowtype;
  v_claim_token uuid := gen_random_uuid();
  v_revision integer := 1;
  v_cache_identity text := lower(trim(coalesce(p_cache_identity, '')));
  v_company_identity text := trim(coalesce(p_company_identity, ''));
  v_country_code text := lower(trim(coalesce(p_country_code, '')));
  v_research_depth text := lower(trim(coalesce(p_research_depth, '')));
  v_research_language text := lower(trim(coalesce(p_research_language, '')));
  v_profile_revision text := trim(coalesce(p_profile_revision, ''));
  v_icp_hash text := trim(coalesce(p_icp_hash, ''));
  v_prompt_version text := trim(coalesce(p_prompt_version, ''));
  v_provider text := trim(coalesce(p_provider, ''));
  v_provider_version text := trim(coalesce(p_provider_version, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null
    or v_cache_identity !~ '^[a-f0-9]{64}$'
    or length(v_company_identity) not between 1 and 500
    or length(v_country_code) not between 1 and 64
    or v_research_depth not in ('basic', 'standard', 'deep')
    or length(v_research_language) not between 2 and 24
    or length(v_profile_revision) not between 1 and 160
    or length(v_icp_hash) not between 1 and 160
    or length(v_prompt_version) not between 1 and 160
    or length(v_provider) not between 1 and 160
    or length(v_provider_version) not between 1 and 160
    or p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid research company artifact claim input' using errcode = '22023';
  end if;

  -- The advisory lock covers an identity even before its first row exists.
  perform pg_advisory_xact_lock(
    hashtextextended(concat('research-company-artifact:', p_organization_id::text, ':', v_cache_identity), 0)
  );

  -- A failed forced refresh must not hide an earlier still-fresh revision.
  select rca.*
  into v_cached_artifact
  from public.research_company_artifacts rca
  where rca.organization_id = p_organization_id
    and rca.cache_identity = v_cache_identity
    and rca.company_identity = v_company_identity
    and rca.country_code = v_country_code
    and rca.research_depth = v_research_depth
    and rca.research_language = v_research_language
    and rca.profile_revision = v_profile_revision
    and rca.icp_hash = v_icp_hash
    and rca.prompt_version = v_prompt_version
    and rca.provider = v_provider
    and rca.provider_version = v_provider_version
    and rca.status in ('completed', 'partial', 'insufficient_data')
    and rca.expires_at > now()
  order by rca.revision desc
  limit 1
  for update;

  if found and not coalesce(p_force_refresh, false) then
    return jsonb_build_object(
      'state', 'cached',
      'claimed', false,
      'claim_token', null,
      'artifact', to_jsonb(v_cached_artifact)
    );
  end if;

  select rca.*
  into v_identity_artifact
  from public.research_company_artifacts rca
  where rca.organization_id = p_organization_id
    and rca.cache_identity = v_cache_identity
    and rca.company_identity = v_company_identity
    and rca.country_code = v_country_code
    and rca.research_depth = v_research_depth
    and rca.research_language = v_research_language
    and rca.profile_revision = v_profile_revision
    and rca.icp_hash = v_icp_hash
    and rca.prompt_version = v_prompt_version
    and rca.provider = v_provider
    and rca.provider_version = v_provider_version
  order by rca.revision desc
  limit 1
  for update;

  if found
    and v_identity_artifact.status = 'running'
    and v_identity_artifact.generation_claim_expires_at > now() then
    return jsonb_build_object(
      'state', 'busy',
      'claimed', false,
      'claim_token', null,
      'artifact', to_jsonb(v_identity_artifact)
    );
  end if;

  if found and v_identity_artifact.status = 'running' then
    update public.research_company_artifacts
    set status = 'failed',
        expires_at = now(),
        generation_claim_token = null,
        generation_claimed_at = null,
        generation_claim_expires_at = null,
        error_code = 'generation_lease_expired',
        error_message = 'The company research generation lease expired before completion.',
        error_metadata = jsonb_build_object('reason', 'generation_lease_expired'),
        completed_at = now(),
        updated_at = now()
    where id = v_identity_artifact.id;
  end if;

  select coalesce(max(rca.revision), 0) + 1
  into v_revision
  from public.research_company_artifacts rca
  where rca.organization_id = p_organization_id
    and rca.cache_identity = v_cache_identity;

  insert into public.research_company_artifacts (
    organization_id, cache_identity, company_identity, country_code,
    research_depth, research_language, profile_revision, icp_hash,
    prompt_version, provider, provider_version, revision, status, payload,
    expires_at, generation_claim_token, generation_claimed_at,
    generation_claim_expires_at, error_metadata, created_at, updated_at
  ) values (
    p_organization_id, v_cache_identity, v_company_identity, v_country_code,
    v_research_depth, v_research_language, v_profile_revision, v_icp_hash,
    v_prompt_version, v_provider, v_provider_version, v_revision, 'running', '{}'::jsonb,
    now() + make_interval(secs => p_lease_seconds), v_claim_token, now(),
    now() + make_interval(secs => p_lease_seconds), '{}'::jsonb, now(), now()
  )
  returning * into v_artifact;

  return jsonb_build_object(
    'state', 'claimed',
    'claimed', true,
    'claim_token', v_claim_token,
    'artifact', to_jsonb(v_artifact)
  );
end;
$$;

create or replace function public.complete_research_company_artifact_v1(
  p_artifact_id uuid,
  p_organization_id uuid,
  p_cache_identity text,
  p_claim_token uuid,
  p_status text,
  p_payload jsonb,
  p_expires_at timestamptz,
  p_error_code text default null,
  p_error_message text default null,
  p_error_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_artifact public.research_company_artifacts%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_artifact_id is null or p_organization_id is null or p_claim_token is null
    or lower(trim(coalesce(p_cache_identity, ''))) !~ '^[a-f0-9]{64}$'
    or v_status not in ('completed', 'partial', 'insufficient_data')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_error_metadata is null or jsonb_typeof(p_error_metadata) <> 'object'
    or p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid research company artifact completion input' using errcode = '22023';
  end if;

  update public.research_company_artifacts
  set status = v_status,
      payload = p_payload,
      expires_at = p_expires_at,
      generation_claim_token = null,
      generation_claimed_at = null,
      generation_claim_expires_at = null,
      error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      error_metadata = p_error_metadata,
      completed_at = now(),
      updated_at = now()
  where id = p_artifact_id
    and organization_id = p_organization_id
    and cache_identity = lower(trim(p_cache_identity))
    and status = 'running'
    and generation_claim_token = p_claim_token
    and generation_claim_expires_at > now()
  returning * into v_artifact;

  if not found then
    raise exception 'research company artifact claim is missing or expired' using errcode = '55000';
  end if;
  return to_jsonb(v_artifact);
end;
$$;

create or replace function public.release_research_company_artifact_claim_v1(
  p_artifact_id uuid,
  p_organization_id uuid,
  p_cache_identity text,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_error_metadata jsonb default '{}'::jsonb
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
  if p_artifact_id is null or p_organization_id is null or p_claim_token is null
    or lower(trim(coalesce(p_cache_identity, ''))) !~ '^[a-f0-9]{64}$'
    or p_error_metadata is null or jsonb_typeof(p_error_metadata) <> 'object' then
    raise exception 'invalid research company artifact release input' using errcode = '22023';
  end if;

  update public.research_company_artifacts
  set status = 'failed',
      expires_at = now(),
      generation_claim_token = null,
      generation_claimed_at = null,
      generation_claim_expires_at = null,
      error_code = coalesce(nullif(trim(coalesce(p_error_code, '')), ''), 'generation_failed'),
      error_message = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), 'Company research generation failed.'),
      error_metadata = p_error_metadata,
      completed_at = now(),
      updated_at = now()
  where id = p_artifact_id
    and organization_id = p_organization_id
    and cache_identity = lower(trim(p_cache_identity))
    and status = 'running'
    and generation_claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.claim_research_company_artifact_v1(uuid, text, text, text, text, text, text, text, text, text, text, boolean, integer) from public, anon, authenticated;
revoke all on function public.complete_research_company_artifact_v1(uuid, uuid, text, uuid, text, jsonb, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_research_company_artifact_claim_v1(uuid, uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.claim_research_company_artifact_v1(uuid, text, text, text, text, text, text, text, text, text, text, boolean, integer) to service_role;
grant execute on function public.complete_research_company_artifact_v1(uuid, uuid, text, uuid, text, jsonb, timestamptz, text, text, jsonb) to service_role;
grant execute on function public.release_research_company_artifact_claim_v1(uuid, uuid, text, uuid, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
