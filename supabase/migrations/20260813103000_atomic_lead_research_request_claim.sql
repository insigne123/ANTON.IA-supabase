-- Own a client research request before quota consumption or provider submission.

alter table public.lead_research_jobs
  alter column provider_report_id drop not null,
  add column if not exists request_idempotency_key text,
  add column if not exists request_claim_state text,
  add column if not exists request_claim_token uuid,
  add column if not exists request_claimed_at timestamptz,
  add column if not exists quota_consumed_at timestamptz,
  add column if not exists quota_day date,
  add column if not exists quota_scope text;

alter table public.lead_research_jobs
  drop constraint if exists lead_research_jobs_provider_report_id_check,
  drop constraint if exists lead_research_jobs_request_idempotency_key_check,
  drop constraint if exists lead_research_jobs_request_claim_state_check,
  drop constraint if exists lead_research_jobs_request_claim_check,
  drop constraint if exists lead_research_jobs_quota_scope_check,
  drop constraint if exists lead_research_jobs_provider_identity_check,
  drop constraint if exists lead_research_jobs_state_check;

alter table public.lead_research_jobs
  add constraint lead_research_jobs_provider_report_id_check
    check (provider_report_id is null or length(trim(provider_report_id)) between 1 and 200),
  add constraint lead_research_jobs_request_idempotency_key_check
    check (request_idempotency_key is null or length(trim(request_idempotency_key)) between 1 and 200),
  add constraint lead_research_jobs_request_claim_state_check
    check (request_claim_state is null or request_claim_state in (
      'pre_provider', 'retryable', 'provider_submitting', 'terminal_pending', 'submitted', 'provider_failed', 'provider_unknown'
    )),
  add constraint lead_research_jobs_request_claim_check check (
    (request_idempotency_key is null and request_claim_state is null and request_claim_token is null and request_claimed_at is null)
    or (
      request_idempotency_key is not null
      and request_claim_state is not null
      and (
        (request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending') and request_claim_token is not null and request_claimed_at is not null)
        or (request_claim_state in ('retryable', 'submitted', 'provider_failed', 'provider_unknown') and request_claim_token is null)
      )
    )
  ),
  add constraint lead_research_jobs_quota_scope_check
    check (quota_scope is null or quota_scope in ('organization', 'user')),
  add constraint lead_research_jobs_provider_identity_check
    check (request_idempotency_key is not null or provider_report_id is not null),
  add constraint lead_research_jobs_state_check check (
    (status = 'queued' and started_at is null and completed_at is null)
    or (status = 'running' and started_at is not null and completed_at is null)
    or (
      status in ('completed', 'partial')
      and started_at is not null
      and completed_at is not null
      and (research_snapshot_id is not null or request_claim_state = 'terminal_pending')
    )
    or (status = 'insufficient_data' and started_at is not null and completed_at is not null)
    or (status = 'failed' and started_at is not null and completed_at is not null and error_message is not null)
    or (status = 'cancelled' and completed_at is not null)
  );

create unique index if not exists lead_research_jobs_request_identity_uidx
  on public.lead_research_jobs(scope_key, user_id, request_idempotency_key)
  where request_idempotency_key is not null;

drop policy if exists "Users can insert scoped lead research jobs" on public.lead_research_jobs;
create policy "Users can insert scoped lead research jobs"
  on public.lead_research_jobs for insert
  with check (
    auth.uid() = user_id
    and request_idempotency_key is null
    and request_claim_state is null
    and request_claim_token is null
    and request_claimed_at is null
    and quota_consumed_at is null
    and quota_day is null
    and quota_scope is null
    and (
      organization_id is null
      or exists (
        select 1 from public.organization_members om
        where om.organization_id = lead_research_jobs.organization_id
          and om.user_id = auth.uid()
      )
    )
  );

create or replace function public.claim_lead_research_request_v1(
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
  v_job public.lead_research_jobs%rowtype;
  v_created boolean := false;
  v_claimed boolean := false;
  v_recovered boolean := false;
  v_claim_token uuid;
  v_row_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id is null
    or nullif(trim(coalesce(p_scope_key, '')), '') is null
    or nullif(trim(coalesce(p_request_idempotency_key, '')), '') is null
    or length(trim(p_request_idempotency_key)) > 200
    or nullif(trim(coalesce(p_lead_ref, '')), '') is null
    or length(trim(p_lead_ref)) > 500
    or p_request_payload is null
    or jsonb_typeof(p_request_payload) <> 'object'
    or p_stale_after_seconds is null
    or p_stale_after_seconds < 60 then
    raise exception 'invalid lead research request claim input' using errcode = '22023';
  end if;
  if (p_organization_id is null and p_scope_key <> concat('user:', p_user_id::text))
    or (p_organization_id is not null and p_scope_key <> p_organization_id::text) then
    raise exception 'lead research request scope does not match owner' using errcode = '22023';
  end if;
  if p_organization_id is not null and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_user_id
  ) then
    raise exception 'lead research request user does not belong to organization' using errcode = '22023';
  end if;

  v_claim_token := gen_random_uuid();
  insert into public.lead_research_jobs (
    scope_key, organization_id, user_id, provider_report_id, request_idempotency_key,
    request_claim_state, request_claim_token, request_claimed_at,
    lead_ref, lead_id, email, company_name, company_domain, provider, status,
    request_payload, attempt_count, max_attempts, created_at, updated_at
  ) values (
    p_scope_key, p_organization_id, p_user_id, null, trim(p_request_idempotency_key),
    'pre_provider', v_claim_token, now(),
    trim(p_lead_ref), nullif(trim(coalesce(p_lead_id, '')), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_company_name, '')), ''),
    nullif(lower(trim(coalesce(p_company_domain, ''))), ''), 'lead-research', 'queued',
    p_request_payload || jsonb_build_object(
      'request_identity', trim(p_request_idempotency_key),
      'provider_status', 'queued'
    ),
    0, 1, now(), now()
  ) on conflict (scope_key, user_id, request_idempotency_key)
    where request_idempotency_key is not null
    do nothing;
  get diagnostics v_row_count = row_count;
  v_created := v_row_count = 1;

  select lrj.*
  into v_job
  from public.lead_research_jobs lrj
  where lrj.scope_key = p_scope_key
    and lrj.user_id = p_user_id
    and lrj.organization_id is not distinct from p_organization_id
    and lrj.request_idempotency_key = trim(p_request_idempotency_key)
  for update;
  if not found then
    raise exception 'lead research request claim was not persisted' using errcode = '55000';
  end if;

  if v_created then
    v_claimed := true;
  elsif v_job.request_claim_state = 'retryable'
    or (
      v_job.request_claim_state = 'pre_provider'
      and v_job.request_claimed_at < now() - make_interval(secs => p_stale_after_seconds)
    ) then
    v_claim_token := gen_random_uuid();
    update public.lead_research_jobs
    set request_claim_state = 'pre_provider',
        request_claim_token = v_claim_token,
        request_claimed_at = now(),
        error_code = null,
        error_message = null,
        result_payload = null,
        updated_at = now()
    where id = v_job.id
    returning * into v_job;
    v_claimed := true;
    v_recovered := true;
  elsif v_job.request_claim_state = 'provider_submitting'
    and v_job.request_claimed_at < now() - make_interval(secs => p_stale_after_seconds) then
    update public.lead_research_jobs
    set request_claim_state = 'provider_unknown',
        request_claim_token = null,
        status = 'failed',
        error_code = 'provider_outcome_unknown',
        error_message = 'Provider submission was interrupted and cannot be retried safely.',
        result_payload = jsonb_build_object(
          'provider_status', 'unknown',
          'error', 'provider_outcome_unknown',
          'message', 'Provider submission was interrupted and cannot be retried safely.'
        ),
        attempt_count = 1,
        started_at = coalesce(started_at, request_claimed_at, now()),
        completed_at = now(),
        updated_at = now()
    where id = v_job.id
    returning * into v_job;
  elsif v_job.request_claim_state = 'terminal_pending' then
    -- The provider result is durable. Reuse the token only for deterministic snapshot recovery.
    v_claim_token := v_job.request_claim_token;
    v_claimed := true;
    v_recovered := true;
  end if;

  if not v_created and not v_recovered then
    v_claim_token := null;
  end if;
  return jsonb_build_object(
    'created', v_created,
    'claimed', v_claimed,
    'recovered', v_recovered,
    'claim_token', v_claim_token,
    'job', to_jsonb(v_job)
  );
end;
$$;

create or replace function public.consume_lead_research_request_quota_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
  v_day date := timezone('utc', now())::date;
  v_scope text := 'organization';
  v_current integer := 0;
  v_baseline integer := 0;
  v_override integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_job_id is null or p_user_id is null or p_claim_token is null or p_organization_id is null
    or p_limit is null or p_limit < 0 then
    raise exception 'invalid lead research quota input' using errcode = '22023';
  end if;

  select lrj.*
  into v_job
  from public.lead_research_jobs lrj
  where lrj.id = p_job_id
    and lrj.scope_key = p_scope_key
    and lrj.organization_id = p_organization_id
    and lrj.user_id = p_user_id
    and lrj.request_claim_state = 'pre_provider'
    and lrj.request_claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'lead research request claim is missing or no longer owned' using errcode = '55000';
  end if;
  if v_job.quota_consumed_at is not null then
    return jsonb_build_object('allowed', true, 'count', 0, 'limit', p_limit, 'reused', true);
  end if;
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = p_user_id
  ) then
    raise exception 'quota user does not belong to organization' using errcode = '22023';
  end if;

  select coalesce(uqo.daily_investigate_limit, 0)
  into v_override
  from public.user_quota_overrides uqo
  where uqo.user_id = p_user_id;
  if coalesce(v_override, 0) > 0 then
    v_scope := 'user';
  end if;

  if v_scope = 'user' then
    select least(count(*), 2147483647)::integer
    into v_baseline
    from public.leads l
    where l.organization_id = p_organization_id
      and l.user_id = p_user_id
      and l.last_investigated_at >= (v_day::timestamp at time zone 'UTC');

    insert into public.antonia_user_daily_usage (organization_id, user_id, date, resource, usage_count)
    values (p_organization_id, p_user_id, v_day, 'investigate', v_baseline)
    on conflict (organization_id, user_id, date, resource) do nothing;
    select u.usage_count
    into v_current
    from public.antonia_user_daily_usage u
    where u.organization_id = p_organization_id
      and u.user_id = p_user_id
      and u.date = v_day
      and u.resource = 'investigate'
    for update;
    if v_current >= p_limit then
      return jsonb_build_object('allowed', false, 'count', v_current, 'limit', p_limit, 'reused', false);
    end if;
    update public.antonia_user_daily_usage
    set usage_count = usage_count + 1, updated_at = now()
    where organization_id = p_organization_id and user_id = p_user_id
      and date = v_day and resource = 'investigate';
  else
    insert into public.antonia_daily_usage (organization_id, date)
    values (p_organization_id, v_day)
    on conflict (organization_id, date) do nothing;
    select u.leads_investigated
    into v_current
    from public.antonia_daily_usage u
    where u.organization_id = p_organization_id and u.date = v_day
    for update;
    if not found or v_current is null then
      raise exception 'organization daily quota row is missing' using errcode = '55000';
    end if;
    if v_current >= p_limit then
      return jsonb_build_object('allowed', false, 'count', v_current, 'limit', p_limit, 'reused', false);
    end if;
    update public.antonia_daily_usage
    set leads_investigated = leads_investigated + 1, updated_at = now()
    where organization_id = p_organization_id and date = v_day;
  end if;

  v_current := v_current + 1;
  update public.lead_research_jobs
  set quota_consumed_at = now(), quota_day = v_day, quota_scope = v_scope, updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('allowed', true, 'count', v_current, 'limit', p_limit, 'reused', false);
end;
$$;

create or replace function public.mark_lead_research_request_submitting_v1(
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
  set request_claim_state = 'provider_submitting', status = 'running',
      request_claimed_at = now(), started_at = coalesce(started_at, now()),
      attempt_count = 1, updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and request_claim_state = 'pre_provider' and request_claim_token = p_claim_token
    and quota_consumed_at is not null;
  return found;
end;
$$;

create or replace function public.store_lead_research_request_terminal_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_provider_report_id text,
  p_provider_status text,
  p_lead_ref text,
  p_lead_id text,
  p_email text,
  p_company_name text,
  p_company_domain text,
  p_request_payload jsonb,
  p_result_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
  v_provider_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_provider_status := lower(trim(coalesce(p_provider_status, '')));
  if nullif(trim(coalesce(p_provider_report_id, '')), '') is null
    or length(trim(p_provider_report_id)) > 200
    or p_request_payload is null
    or jsonb_typeof(p_request_payload) <> 'object'
    or p_result_payload is null
    or jsonb_typeof(p_result_payload) <> 'object'
    or v_provider_status not in ('completed', 'partial') then
    raise exception 'invalid lead research provider response' using errcode = '22023';
  end if;
  update public.lead_research_jobs
  set provider_report_id = trim(p_provider_report_id),
      request_claim_state = 'terminal_pending', request_claimed_at = now(),
      lead_ref = trim(p_lead_ref), lead_id = nullif(trim(coalesce(p_lead_id, '')), ''),
      email = nullif(lower(trim(coalesce(p_email, ''))), ''),
      company_name = nullif(trim(coalesce(p_company_name, '')), ''),
      company_domain = nullif(lower(trim(coalesce(p_company_domain, ''))), ''),
      status = v_provider_status,
      request_payload = p_request_payload || jsonb_build_object(
        'request_identity', request_idempotency_key,
        'provider_report_id', trim(p_provider_report_id),
        'provider_status', v_provider_status
      ),
      result_payload = p_result_payload,
      error_code = null, error_message = null, attempt_count = 1,
      started_at = coalesce(started_at, now()), completed_at = now(), updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and request_claim_state = 'provider_submitting' and request_claim_token = p_claim_token
  returning * into v_job;
  if not found then
    raise exception 'lead research request terminal result lost its claim' using errcode = '55000';
  end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.complete_lead_research_request_claim_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_provider_report_id text,
  p_provider_status text,
  p_lead_ref text,
  p_lead_id text,
  p_email text,
  p_company_name text,
  p_company_domain text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_provider_report_id, '')), '') is null
    or length(trim(p_provider_report_id)) > 200
    or p_request_payload is null
    or jsonb_typeof(p_request_payload) <> 'object' then
    raise exception 'invalid lead research provider response' using errcode = '22023';
  end if;
  update public.lead_research_jobs
  set provider_report_id = trim(p_provider_report_id),
      request_claim_state = 'submitted', request_claim_token = null,
      lead_ref = trim(p_lead_ref), lead_id = nullif(trim(coalesce(p_lead_id, '')), ''),
      email = nullif(lower(trim(coalesce(p_email, ''))), ''),
      company_name = nullif(trim(coalesce(p_company_name, '')), ''),
      company_domain = nullif(lower(trim(coalesce(p_company_domain, ''))), ''),
      status = 'running',
      request_payload = p_request_payload || jsonb_build_object(
        'request_identity', request_idempotency_key,
        'provider_report_id', trim(p_provider_report_id),
        'provider_status', lower(trim(coalesce(p_provider_status, 'queued')))
      ),
      result_payload = jsonb_build_object('provider_status', lower(trim(coalesce(p_provider_status, 'queued')))),
      error_code = null, error_message = null, attempt_count = 1,
      started_at = coalesce(started_at, now()), completed_at = null, updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and request_claim_state = 'provider_submitting' and request_claim_token = p_claim_token
  returning * into v_job;
  if not found then
    raise exception 'lead research request provider completion lost its claim' using errcode = '55000';
  end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.finalize_lead_research_request_terminal_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_provider_report_id text,
  p_provider_status text,
  p_lead_ref text,
  p_lead_id text,
  p_email text,
  p_company_name text,
  p_company_domain text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_job public.lead_research_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_provider_report_id, '')), '') is null
    or length(trim(p_provider_report_id)) > 200 then
    raise exception 'invalid lead research provider response' using errcode = '22023';
  end if;

  update public.lead_research_jobs
  set request_claim_state = 'submitted', request_claim_token = null, request_claimed_at = null,
      updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and provider_report_id = trim(p_provider_report_id)
    and request_claim_state = 'terminal_pending' and request_claim_token = p_claim_token
    and research_snapshot_id is not null
  returning * into v_job;

  if not found then
    select lrj.*
    into v_job
    from public.lead_research_jobs lrj
    where lrj.id = p_job_id and lrj.scope_key = p_scope_key
      and lrj.organization_id is not distinct from p_organization_id and lrj.user_id = p_user_id
      and lrj.provider_report_id = trim(p_provider_report_id)
      and lrj.request_claim_state = 'submitted'
      and lrj.research_snapshot_id is not null;
  end if;
  if not found then
    raise exception 'lead research request completion lost its claim or snapshot' using errcode = '55000';
  end if;
  return to_jsonb(v_job);
end;
$$;

create or replace function public.release_lead_research_request_claim_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
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
  set request_claim_state = 'retryable', request_claim_token = null, request_claimed_at = null,
      status = 'queued', error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      result_payload = null, started_at = null, completed_at = null, updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and request_claim_state in ('pre_provider', 'provider_submitting') and request_claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.fail_lead_research_request_claim_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_result_payload jsonb
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
  set request_claim_state = 'provider_failed', request_claim_token = null,
      status = 'failed', error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      error_message = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), 'Provider rejected the research request.'),
      result_payload = coalesce(p_result_payload, '{}'::jsonb) || jsonb_build_object('provider_status', 'failed'),
      attempt_count = 1, started_at = coalesce(started_at, now()), completed_at = now(), updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and request_claim_state = 'provider_submitting' and request_claim_token = p_claim_token;
  return found;
end;
$$;

create or replace function public.mark_lead_research_request_unknown_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text
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
  set request_claim_state = 'provider_unknown', request_claim_token = null,
      status = 'failed', error_code = coalesce(nullif(trim(coalesce(p_error_code, '')), ''), 'provider_outcome_unknown'),
      error_message = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), 'The provider outcome is unknown and cannot be retried safely.'),
      result_payload = jsonb_build_object(
        'provider_status', 'unknown',
        'error', coalesce(nullif(trim(coalesce(p_error_code, '')), ''), 'provider_outcome_unknown'),
        'message', coalesce(nullif(trim(coalesce(p_error_message, '')), ''), 'The provider outcome is unknown and cannot be retried safely.')
      ),
      attempt_count = 1, started_at = coalesce(started_at, now()), completed_at = now(), updated_at = now()
  where id = p_job_id and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id and user_id = p_user_id
    and request_claim_state = 'provider_submitting' and request_claim_token = p_claim_token;
  return found;
end;
$$;

revoke all on function public.claim_lead_research_request_v1(text, uuid, uuid, text, text, text, text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.consume_lead_research_request_quota_v1(uuid, text, uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_lead_research_request_submitting_v1(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.store_lead_research_request_terminal_v1(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.complete_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.finalize_lead_research_request_terminal_v1(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.release_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mark_lead_research_request_unknown_v1(uuid, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.claim_lead_research_request_v1(text, uuid, uuid, text, text, text, text, text, text, jsonb, integer) to service_role;
grant execute on function public.consume_lead_research_request_quota_v1(uuid, text, uuid, uuid, uuid, integer) to service_role;
grant execute on function public.mark_lead_research_request_submitting_v1(uuid, text, uuid, uuid, uuid) to service_role;
grant execute on function public.store_lead_research_request_terminal_v1(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.complete_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.finalize_lead_research_request_terminal_v1(uuid, text, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.release_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.fail_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.mark_lead_research_request_unknown_v1(uuid, text, uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
