-- Durable, tenant-scoped Apollo company observations. This is intentionally
-- separate from the quota journal so research can reuse company context by
-- domain without scanning operational idempotency records.
create table public.apollo_organization_contexts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_domain text not null,
  apollo_organization_id text,
  organization_context jsonb not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, normalized_domain),
  constraint apollo_organization_contexts_domain_check check (
    char_length(normalized_domain) between 3 and 253
    and normalized_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  constraint apollo_organization_contexts_provider_id_check check (
    apollo_organization_id is null
    or char_length(trim(apollo_organization_id)) between 1 and 255
  ),
  constraint apollo_organization_contexts_context_check check (
    jsonb_typeof(organization_context) = 'object'
    and organization_context ->> 'primary_domain' is not null
    and organization_context ->> 'primary_domain' = normalized_domain
    and organization_context - array[
      'id', 'name', 'primary_domain', 'website_url', 'linkedin_url',
      'industry', 'estimated_num_employees', 'city', 'state', 'country',
      'short_description', 'keywords', 'founded_year', 'annual_revenue',
      'total_funding'
    ]::text[] = '{}'::jsonb
  )
);

create index apollo_organization_contexts_observed_idx
  on public.apollo_organization_contexts (organization_id, user_id, observed_at desc);

alter table public.apollo_organization_contexts enable row level security;
revoke all on table public.apollo_organization_contexts
  from public, anon, authenticated;
grant all on table public.apollo_organization_contexts to service_role;

create policy "Apollo organization contexts are service role only"
  on public.apollo_organization_contexts
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.complete_apollo_organization_enrichment_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_operation_id text,
  p_claim_token uuid,
  p_normalized_domain text,
  p_apollo_organization_id text,
  p_organization_context jsonb,
  p_observed_at timestamptz,
  p_response_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_operation_id text := trim(coalesce(p_operation_id, ''));
  v_domain text := lower(trim(coalesce(p_normalized_domain, '')));
  v_apollo_organization_id text := nullif(trim(coalesce(p_apollo_organization_id, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null or p_claim_token is null
    or char_length(v_operation_id) not between 1 and 200
    or char_length(v_domain) not between 3 and 253
    or v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or (v_apollo_organization_id is not null and char_length(v_apollo_organization_id) > 255)
    or p_organization_context is null
    or jsonb_typeof(p_organization_context) <> 'object'
    or coalesce(p_organization_context ->> 'primary_domain', '') <> v_domain
    or p_organization_context - array[
      'id', 'name', 'primary_domain', 'website_url', 'linkedin_url',
      'industry', 'estimated_num_employees', 'city', 'state', 'country',
      'short_description', 'keywords', 'founded_year', 'annual_revenue',
      'total_funding'
    ]::text[] <> '{}'::jsonb
    or p_observed_at is null
    or p_observed_at > now() + interval '5 minutes'
    or p_response_payload is null
    or jsonb_typeof(p_response_payload) <> 'object' then
    raise exception 'invalid Apollo organization context' using errcode = '22023';
  end if;

  perform 1
  from public.antonia_quota_operations operation
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = 'enrich'
    and operation.operation_id = v_operation_id
    and operation.status = 'submitted'
    and operation.claim_token = p_claim_token
    and operation.quota_allowed
  for update;
  if not found then
    return false;
  end if;

  insert into public.apollo_organization_contexts (
    organization_id,
    user_id,
    normalized_domain,
    apollo_organization_id,
    organization_context,
    observed_at
  ) values (
    p_organization_id,
    p_user_id,
    v_domain,
    v_apollo_organization_id,
    p_organization_context,
    p_observed_at
  )
  on conflict (organization_id, user_id, normalized_domain) do update
  set apollo_organization_id = excluded.apollo_organization_id,
      organization_context = excluded.organization_context,
      observed_at = excluded.observed_at,
      updated_at = now()
  where excluded.observed_at >= public.apollo_organization_contexts.observed_at;

  update public.antonia_quota_operations operation
  set status = 'completed',
      claim_token = null,
      completed_at = now(),
      response_status = 200,
      response_payload = p_response_payload,
      updated_at = now()
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = 'enrich'
    and operation.operation_id = v_operation_id
    and operation.status = 'submitted'
    and operation.claim_token = p_claim_token
    and operation.quota_allowed;

  return found;
end;
$$;

revoke all on function public.complete_apollo_organization_enrichment_v1(
  uuid, uuid, text, uuid, text, text, jsonb, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_apollo_organization_enrichment_v1(
  uuid, uuid, text, uuid, text, text, jsonb, timestamptz, jsonb
) to service_role;

notify pgrst, 'reload schema';
