-- Keep native research and draft generation from racing a privacy deletion.

create table if not exists public.native_draft_generation_claims (
  draft_id uuid primary key,
  version_id uuid,
  research_snapshot_id uuid not null references public.research_snapshots(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_hash text,
  subject_email text not null,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint native_draft_generation_claims_email_check
    check (length(trim(subject_email)) between 3 and 320)
);

-- Some local databases already contain the earlier claim shape keyed by
-- identity_hash. Keep those installations compatible while new claims use the
-- privacy-aware email field above.
alter table public.native_draft_generation_claims
  add column if not exists version_id uuid,
  add column if not exists identity_hash text,
  add column if not exists subject_email text,
  add column if not exists created_at timestamptz not null default now();
alter table public.native_draft_generation_claims
  alter column version_id drop not null,
  alter column identity_hash drop not null;

create index if not exists native_draft_generation_claims_subject_idx
  on public.native_draft_generation_claims ((lower(trim(subject_email))), claimed_at);

alter table public.native_draft_generation_claims enable row level security;
revoke all on table public.native_draft_generation_claims from public, anon, authenticated;
grant all on table public.native_draft_generation_claims to service_role;

create or replace function public.claim_native_lead_research_request_v1(
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_request_idempotency_key text,
  p_lead_ref text,
  p_lead_id text,
  p_email text,
  p_company_name text,
  p_company_domain text,
  p_request_payload jsonb,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_email <> '' then
    perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
    if exists (
      select 1
      from public.unsubscribed_emails ue
      where lower(trim(ue.email)) = v_email
        and (
          (ue.user_id is null and ue.organization_id is null)
          or ue.user_id = p_user_id
          or ue.organization_id = p_organization_id
        )
    ) then
      return jsonb_build_object('suppressed', true);
    end if;
  end if;

  return public.claim_lead_research_request_v1(
    p_scope_key,
    p_organization_id,
    p_user_id,
    p_request_idempotency_key,
    p_lead_ref,
    p_lead_id,
    p_email,
    p_company_name,
    p_company_domain,
    p_request_payload,
    p_stale_after_seconds
  );
end;
$$;

create or replace function public.cancel_native_lead_research_request_claim_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
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

  update public.lead_research_jobs
  set request_claim_state = 'provider_failed',
      request_claim_token = null,
      request_claimed_at = null,
      status = 'failed',
      error_code = 'privacy_suppressed',
      error_message = 'Research was cancelled because the recipient is suppressed.',
      result_payload = jsonb_build_object(
        'provider_status', 'failed',
        'error', 'privacy_suppressed'
      ),
      attempt_count = 1,
      started_at = coalesce(started_at, now()),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id
    and user_id = p_user_id
    and request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
    and request_claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function public.claim_native_draft_generation_v1(
  p_draft_id uuid,
  p_research_snapshot_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_subject_email text,
  p_stale_after_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := lower(trim(coalesce(p_subject_email, '')));
  v_claim public.native_draft_generation_claims%rowtype;
  v_claim_token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_draft_id is null or p_research_snapshot_id is null or p_organization_id is null
    or p_user_id is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_stale_after_seconds is null or p_stale_after_seconds < 60 then
    raise exception 'invalid native draft generation claim input' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = p_user_id
  ) then
    raise exception 'draft organization membership is invalid' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
  if exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(ue.email)) = v_email
      and (
        (ue.user_id is null and ue.organization_id is null)
        or ue.user_id = p_user_id
        or ue.organization_id = p_organization_id
      )
  ) then
    return jsonb_build_object('state', 'suppressed');
  end if;
  if not exists (
    select 1
    from public.research_snapshots rs
    where rs.id = p_research_snapshot_id
      and rs.organization_id = p_organization_id
      and rs.user_id = p_user_id
      and lower(trim(coalesce(rs.payload #>> '{subject,email}', ''))) = v_email
  ) then
    raise exception 'draft snapshot is missing or does not match the recipient' using errcode = '22023';
  end if;

  select * into v_claim
  from public.native_draft_generation_claims ndgc
  where ndgc.draft_id = p_draft_id
  for update;

  if found and v_claim.claimed_at >= now() - make_interval(secs => p_stale_after_seconds) then
    return jsonb_build_object('state', 'busy');
  end if;

  if found then
    update public.native_draft_generation_claims
    set research_snapshot_id = p_research_snapshot_id,
        organization_id = p_organization_id,
        user_id = p_user_id,
        subject_email = v_email,
        claim_token = v_claim_token,
        claimed_at = now(),
        updated_at = now()
    where draft_id = p_draft_id;
  else
    insert into public.native_draft_generation_claims (
      draft_id, research_snapshot_id, organization_id, user_id, subject_email, claim_token
    ) values (
      p_draft_id, p_research_snapshot_id, p_organization_id, p_user_id, v_email, v_claim_token
    );
  end if;

  return jsonb_build_object('state', 'claimed', 'claimToken', v_claim_token);
end;
$$;

create or replace function public.release_native_draft_generation_claim_v1(
  p_draft_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
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

  delete from public.native_draft_generation_claims
  where draft_id = p_draft_id
    and organization_id = p_organization_id
    and user_id = p_user_id
    and claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function public.delete_native_research_messaging_subject_v1(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
  insert into public.unsubscribed_emails (email, reason)
  select v_email, 'privacy_request_delete_preserve_block'
  where not exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(ue.email)) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  )
  on conflict do nothing;

  delete from public.native_draft_generation_claims ndgc
  where lower(trim(ndgc.subject_email)) = v_email
    and ndgc.claimed_at < now() - make_interval(secs => 900);

  if exists (
    select 1
    from public.native_draft_generation_claims ndgc
    where lower(trim(ndgc.subject_email)) = v_email
  ) then
    return jsonb_build_object(
      'outcome', 'pending',
      'blocked', true,
      'reason', 'native_draft_generation_in_progress'
    );
  end if;
  if exists (
    select 1
    from public.lead_research_jobs lrj
    where lrj.provider = 'native-research-v1'
      and lower(trim(coalesce(lrj.email, ''))) = v_email
      and lrj.request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
  ) then
    return jsonb_build_object(
      'outcome', 'pending',
      'blocked', true,
      'reason', 'native_research_in_progress'
    );
  end if;

  return public.delete_research_messaging_subject_v1(v_email);
end;
$$;

revoke all on function public.claim_native_lead_research_request_v1(text, uuid, uuid, text, text, text, text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_native_draft_generation_v1(uuid, uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.release_native_draft_generation_claim_v1(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_native_research_messaging_subject_v1(text) from public, anon, authenticated;
grant execute on function public.claim_native_lead_research_request_v1(text, uuid, uuid, text, text, text, text, text, text, jsonb, integer) to service_role;
grant execute on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid) to service_role;
grant execute on function public.claim_native_draft_generation_v1(uuid, uuid, uuid, uuid, text, integer) to service_role;
grant execute on function public.release_native_draft_generation_claim_v1(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.delete_native_research_messaging_subject_v1(text) to service_role;

notify pgrst, 'reload schema';
