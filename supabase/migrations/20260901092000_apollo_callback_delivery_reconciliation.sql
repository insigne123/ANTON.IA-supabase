-- Completes the product quota only after every callback created for the
-- operation is terminal. Locking the quota row serializes concurrent delivery.
create or replace function public.settle_apollo_enrichment_quota_if_ready_v1(
  p_callback_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_operation public.antonia_quota_operations%rowtype;
  v_remaining_callbacks integer;
  v_submitted_count integer := 0;
  v_refund_count integer := 0;
  v_reveal_phone boolean := false;
  v_updated_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id;
  if not found then
    return false;
  end if;

  select operation.* into v_operation
  from public.antonia_quota_operations operation
  where operation.organization_id = v_callback.organization_id
    and operation.user_id = v_callback.user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_callback.operation_id
    and operation.status = 'submitted'
  for update;

  if not found or v_operation.claim_token is null then
    return false;
  end if;

  select count(*) into v_remaining_callbacks
  from public.apollo_enrichment_callbacks callback
  where callback.organization_id = v_callback.organization_id
    and callback.user_id = v_callback.user_id
    and callback.quota_resource = v_callback.quota_resource
    and callback.operation_id = v_callback.operation_id
    and callback.status <> 'terminal';

  if v_remaining_callbacks > 0 then
    return false;
  end if;
  select
    count(*) filter (where callback.provider_queued_at is not null),
    coalesce(bool_or(callback.reveal_phone), false)
  into v_submitted_count, v_reveal_phone
  from public.apollo_enrichment_callbacks callback
  where callback.organization_id = v_callback.organization_id
    and callback.user_id = v_callback.user_id
    and callback.quota_resource = v_callback.quota_resource
    and callback.operation_id = v_callback.operation_id;

  v_refund_count := v_operation.consumed_count - v_submitted_count;
  if v_refund_count < 0 then
    raise exception 'Apollo callback count exceeds consumed quota' using errcode = '55000';
  end if;
  if v_refund_count > 0 then
    if v_operation.quota_scope = 'user' then
      update public.antonia_user_daily_usage usage
      set usage_count = usage.usage_count - v_refund_count,
          updated_at = now()
      where usage.organization_id = v_operation.organization_id
        and usage.user_id = v_operation.user_id
        and usage.date = v_operation.quota_day
        and usage.resource = v_operation.resource
        and usage.usage_count >= v_refund_count;
    else
      update public.antonia_daily_usage usage
      set leads_enriched = usage.leads_enriched
            - case when v_operation.resource = 'enrich' then v_refund_count else 0 end,
          leads_investigated = usage.leads_investigated
            - case when v_operation.resource = 'investigate' then v_refund_count else 0 end,
          updated_at = now()
      where usage.organization_id = v_operation.organization_id
        and usage.date = v_operation.quota_day
        and usage.leads_enriched >= case when v_operation.resource = 'enrich' then v_refund_count else 0 end
        and usage.leads_investigated >= case when v_operation.resource = 'investigate' then v_refund_count else 0 end;
    end if;
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 1 then
      raise exception 'Apollo quota bucket is missing during partial refund' using errcode = '55000';
    end if;

    update public.antonia_quota_operations operation
    set consumed_count = v_submitted_count,
        quota_count_after = operation.quota_count_after - v_refund_count,
        updated_at = now()
    where operation.organization_id = v_operation.organization_id
      and operation.user_id = v_operation.user_id
      and operation.resource = v_operation.resource
      and operation.operation_id = v_operation.operation_id
      and operation.status = 'submitted'
      and operation.claim_token = v_operation.claim_token
      and operation.quota_count_after >= v_refund_count;
    if not found then
      raise exception 'Apollo quota operation changed during partial refund' using errcode = '55000';
    end if;
  end if;

  return public.complete_antonia_quota_operation_v1(
    v_callback.organization_id,
    v_callback.user_id,
    v_callback.quota_resource,
    v_callback.operation_id,
    v_operation.claim_token,
    'completed',
    case when v_reveal_phone then 202 else 200 end,
    jsonb_build_object(
      'queued', v_reveal_phone,
      'provider', 'apollo',
      'operationId', v_callback.operation_id,
      'operationStatus', 'completed'
    )
  );
end;
$$;

-- The webhook and the recovery poll both enter through this boundary. Target,
-- tenant and writable fields are derived exclusively from the locked row.
create or replace function public.apply_apollo_enrichment_callback_v1(
  p_token_hash text,
  p_provider_request_id text,
  p_provider_status text,
  p_payload_hash text,
  p_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_provider_request_id text := trim(coalesce(p_provider_request_id, ''));
  v_provider_status text := upper(trim(coalesce(p_provider_status, '')));
  v_candidate_person_id text;
  v_resolved_person_id text;
  v_email text;
  v_privacy_subject_hash text;
  v_email_status text;
  v_phone_numbers jsonb := '[]'::jsonb;
  v_primary_phone text;
  v_requests_email boolean;
  v_requests_phone boolean;
  v_has_phone boolean := false;
  v_terminal_state text;
  v_enrichment_status text;
  v_target_count integer := 0;
  v_target_status text;
  v_outcome text := 'processed';
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_token_hash !~ '^[0-9a-f]{64}$'
    or char_length(v_provider_request_id) not between 1 and 255
    or char_length(v_provider_status) not between 1 and 64
    or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid callback delivery identity' using errcode = '22023';
  end if;
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'invalid enrichment candidate' using errcode = '22023';
  end if;
  if (p_candidate ? 'phone_numbers' and jsonb_typeof(p_candidate -> 'phone_numbers') <> 'array') then
    raise exception 'invalid enrichment candidate' using errcode = '22023';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.token_hash = v_token_hash;

  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  if v_callback.status <> 'terminal' then
    perform 1
    from public.antonia_quota_operations operation
    where operation.organization_id = v_callback.organization_id
      and operation.user_id = v_callback.user_id
      and operation.resource = v_callback.quota_resource
      and operation.operation_id = v_callback.operation_id
      and operation.status = 'submitted'
    for update;
  end if;
  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.token_hash = v_token_hash
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;

  update public.apollo_enrichment_callbacks callback
  set delivery_count = callback.delivery_count + 1,
      last_delivery_at = v_now,
      provider_status = v_provider_status,
      payload_hash = p_payload_hash,
      updated_at = v_now
  where callback.id = v_callback.id;

  if v_callback.status = 'terminal' then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'terminalState', v_callback.terminal_state
    );
  end if;
  if v_callback.provider_request_id is not null
    and v_callback.provider_request_id <> v_provider_request_id then
    update public.apollo_enrichment_callbacks callback
    set last_error_code = 'provider_request_mismatch', updated_at = v_now
    where callback.id = v_callback.id;
    return jsonb_build_object('outcome', 'provider_request_mismatch');
  end if;

  v_candidate_person_id := nullif(trim(coalesce(p_candidate ->> 'apollo_person_id', '')), '');
  if v_candidate_person_id is not null and char_length(v_candidate_person_id) > 255 then
    raise exception 'invalid Apollo person id' using errcode = '22023';
  end if;
  if v_callback.apollo_person_id is not null and v_candidate_person_id is not null
    and v_callback.apollo_person_id <> v_candidate_person_id then
    update public.apollo_enrichment_callbacks callback
    set last_error_code = 'apollo_person_mismatch', updated_at = v_now
    where callback.id = v_callback.id;
    return jsonb_build_object('outcome', 'apollo_person_mismatch');
  end if;
  v_resolved_person_id := coalesce(v_callback.apollo_person_id, v_candidate_person_id);

  if v_provider_status in ('CANCELLED', 'CANCELED') then
    v_terminal_state := 'cancelled';
  elsif v_provider_status in ('EXPIRED', 'REQUEST_ID_EXPIRED') then
    v_terminal_state := 'expired';
  elsif v_provider_status in ('FAILED', 'ERROR', 'REQUEST_ID_UNKNOWN', 'INVALID_REQUEST_ID') then
    v_terminal_state := 'failed';
  elsif v_provider_status in ('NO_DATA', 'NO_PHONE') then
    v_terminal_state := 'no_data';
  elsif v_provider_status not in ('SUCCEEDED', 'SUCCESS', 'COMPLETED', 'READY') then
    update public.apollo_enrichment_callbacks callback
    set last_error_code = 'unsupported_provider_status', updated_at = v_now
    where callback.id = v_callback.id;
    return jsonb_build_object('outcome', 'unsupported_provider_status');
  end if;

  v_requests_email := 'person.email' = any(v_callback.requested_fields);
  v_requests_phone := 'person.phone_numbers' = any(v_callback.requested_fields);

  if v_terminal_state is null and v_requests_email then
    v_email := nullif(trim(coalesce(p_candidate ->> 'email', '')), '');
    v_email_status := nullif(trim(coalesce(p_candidate ->> 'email_status', '')), '');
  end if;
  if v_email is not null and (
    char_length(v_email) > 320
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    v_email := null;
    v_email_status := null;
  end if;
  if v_email_status is not null and char_length(v_email_status) > 64 then
    v_email_status := null;
  end if;
  if v_email is not null then
    v_privacy_subject_hash := encode(
      extensions.digest(convert_to(lower(trim(v_email)), 'UTF8'), 'sha256'),
      'hex'
    );
  end if;

  if v_terminal_state is null and v_requests_phone and p_candidate ? 'phone_numbers' then
    if jsonb_array_length(p_candidate -> 'phone_numbers') > 20 then
      raise exception 'too many phone numbers' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_candidate -> 'phone_numbers') as phone(value)
      where jsonb_typeof(phone.value) <> 'object'
        or nullif(trim(coalesce(phone.value ->> 'sanitized_number', '')), '') is null
        or char_length(trim(coalesce(phone.value ->> 'sanitized_number', ''))) > 64
    ) then
      raise exception 'invalid phone number candidate' using errcode = '22023';
    end if;

    v_phone_numbers := p_candidate -> 'phone_numbers';
    v_has_phone := jsonb_array_length(v_phone_numbers) > 0;
    v_primary_phone := nullif(trim(coalesce(p_candidate ->> 'primary_phone', '')), '');
    if v_primary_phone is null and v_has_phone then
      v_primary_phone := nullif(trim(coalesce(v_phone_numbers -> 0 ->> 'sanitized_number', '')), '');
    end if;
    if v_primary_phone is not null and char_length(v_primary_phone) > 64 then
      v_primary_phone := null;
    end if;
  end if;

  if v_terminal_state is null then
    v_terminal_state := case
      when v_email is not null or v_has_phone then 'succeeded'
      else 'no_data'
    end;
  end if;

  if v_terminal_state <> 'succeeded' then
    v_email := null;
    v_email_status := null;
    v_phone_numbers := '[]'::jsonb;
    v_primary_phone := null;
    v_has_phone := false;
  end if;

  v_enrichment_status := case
    when v_terminal_state = 'succeeded' then 'completed'
    when v_terminal_state = 'no_data' and v_requests_phone then 'no_phone'
    else 'failed'
  end;

  if v_callback.target_table = 'enriched_leads' then
    update public.enriched_leads target
    set email = case when v_email is null then target.email else v_email end,
        email_status = case when v_email_status is null then target.email_status else v_email_status end,
        phone_numbers = case when v_has_phone then v_phone_numbers else target.phone_numbers end,
        primary_phone = case when v_primary_phone is null then target.primary_phone else v_primary_phone end,
        source_provider = case when v_resolved_person_id is null then target.source_provider else 'apollo' end,
        source_provider_id = coalesce(v_resolved_person_id, target.source_provider_id),
        enrichment_status = v_enrichment_status,
        updated_at = v_now
    where target.id = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id
    returning target.enrichment_status into v_target_status;
    get diagnostics v_target_count = row_count;
  elsif v_callback.target_table = 'enriched_opportunities' then
    update public.enriched_opportunities target
    set email = case when v_email is null then target.email else v_email end,
        email_status = case when v_email_status is null then target.email_status else v_email_status end,
        phone_numbers = case when v_has_phone then v_phone_numbers else target.phone_numbers end,
        primary_phone = case when v_primary_phone is null then target.primary_phone else v_primary_phone end,
        source_provider = case when v_resolved_person_id is null then target.source_provider else 'apollo' end,
        source_provider_id = coalesce(v_resolved_person_id, target.source_provider_id),
        enrichment_status = v_enrichment_status,
        updated_at = v_now
    where target.id::text = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id
    returning target.enrichment_status into v_target_status;
    get diagnostics v_target_count = row_count;
  elsif v_callback.target_table = 'people_search_leads' then
    update public.people_search_leads target
    set email = case when v_email is null then target.email else v_email end,
        email_status = case when v_email_status is null then target.email_status else v_email_status end,
        phone_numbers = case when v_has_phone then v_phone_numbers else target.phone_numbers end,
        primary_phone = case when v_primary_phone is null then target.primary_phone else v_primary_phone end,
        source_provider = case when v_resolved_person_id is null then target.source_provider else 'apollo' end,
        source_provider_id = coalesce(v_resolved_person_id, target.source_provider_id),
        enrichment_status = v_enrichment_status,
        updated_at = v_now
    where target.id = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id::text
    returning target.enrichment_status into v_target_status;
    get diagnostics v_target_count = row_count;
  else
    raise exception 'unsupported callback target' using errcode = '22023';
  end if;

  if v_target_count = 0 then
    v_terminal_state := 'failed';
    v_outcome := 'target_not_found';
  elsif v_target_status = 'suppressed' then
    v_terminal_state := 'cancelled';
    v_outcome := 'processed';
  end if;

  update public.apollo_enrichment_callbacks callback
  set provider_request_id = coalesce(callback.provider_request_id, v_provider_request_id),
      apollo_person_id = coalesce(callback.apollo_person_id, v_candidate_person_id),
      provider_status = v_provider_status,
      payload_hash = p_payload_hash,
      privacy_subject_hash = coalesce(v_privacy_subject_hash, callback.privacy_subject_hash),
      status = 'terminal',
      terminal_state = v_terminal_state,
      terminal_at = v_now,
      processed_at = v_now,
      reconciliation_claimed_at = null,
      reconciliation_not_before = null,
      reconciliation_last_error_code = null,
      last_error_code = case when v_target_count = 0 then 'target_not_found' else null end,
      updated_at = v_now
  where callback.id = v_callback.id;

  perform public.settle_apollo_enrichment_quota_if_ready_v1(v_callback.id);

  return jsonb_build_object('outcome', v_outcome, 'terminalState', v_terminal_state);
end;
$$;

-- Deterministic failures and expiry do not carry contact data, so they settle by
-- callback ID while preserving the same target and quota invariants.
create or replace function public.settle_apollo_enrichment_callback_v1(
  p_callback_id uuid,
  p_terminal_state text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_terminal_state text := lower(trim(coalesce(p_terminal_state, '')));
  v_error_code text := nullif(trim(coalesce(p_error_code, '')), '');
  v_target_count integer := 0;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_callback_id is null
    or v_terminal_state not in ('no_data', 'failed', 'cancelled', 'expired')
    or (v_error_code is not null and char_length(v_error_code) > 100) then
    raise exception 'invalid callback settlement' using errcode = '22023';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id;
  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  if v_callback.status <> 'terminal' then
    perform 1
    from public.antonia_quota_operations operation
    where operation.organization_id = v_callback.organization_id
      and operation.user_id = v_callback.user_id
      and operation.resource = v_callback.quota_resource
      and operation.operation_id = v_callback.operation_id
      and operation.status in ('claimed', 'submitted')
    for update;
  end if;
  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  if v_callback.status = 'terminal' then
    return jsonb_build_object('outcome', 'duplicate', 'terminalState', v_callback.terminal_state);
  end if;

  if v_callback.target_table = 'enriched_leads' then
    update public.enriched_leads target
    set enrichment_status = case when v_terminal_state = 'no_data' then 'no_phone' else 'failed' end,
        updated_at = v_now
    where target.id = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id;
    get diagnostics v_target_count = row_count;
  elsif v_callback.target_table = 'enriched_opportunities' then
    update public.enriched_opportunities target
    set enrichment_status = case when v_terminal_state = 'no_data' then 'no_phone' else 'failed' end,
        updated_at = v_now
    where target.id::text = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id;
    get diagnostics v_target_count = row_count;
  elsif v_callback.target_table = 'people_search_leads' then
    update public.people_search_leads target
    set enrichment_status = case when v_terminal_state = 'no_data' then 'no_phone' else 'failed' end,
        updated_at = v_now
    where target.id = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id::text;
    get diagnostics v_target_count = row_count;
  end if;

  update public.apollo_enrichment_callbacks callback
  set status = 'terminal',
      terminal_state = case when v_target_count = 0 then 'failed' else v_terminal_state end,
      terminal_at = v_now,
      processed_at = v_now,
      reconciliation_claimed_at = null,
      reconciliation_not_before = null,
      reconciliation_last_error_code = null,
      last_error_code = case when v_target_count = 0 then 'target_not_found' else v_error_code end,
      updated_at = v_now
  where callback.id = v_callback.id;

  perform public.settle_apollo_enrichment_quota_if_ready_v1(v_callback.id);

  return jsonb_build_object(
    'outcome', case when v_target_count = 0 then 'target_not_found' else 'settled' end,
    'terminalState', case when v_target_count = 0 then 'failed' else v_terminal_state end
  );
end;
$$;

create or replace function public.claim_apollo_enrichment_reconciliation_candidates_v1(
  p_limit integer,
  p_stale_before timestamptz,
  p_cooldown_before timestamptz,
  p_claim_before timestamptz
)
returns table (
  callback_id uuid,
  token_hash text,
  provider_request_id text,
  apollo_person_id text,
  expires_at timestamptz,
  reconciliation_claimed_at timestamptz,
  reconciliation_attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100
    or p_stale_before is null or p_cooldown_before is null or p_claim_before is null then
    raise exception 'invalid reconciliation claim input' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select callback.id
    from public.apollo_enrichment_callbacks callback
    where callback.status in ('pending', 'processing')
      and (
        callback.expires_at <= v_now
        or (
          callback.provider_queued_at is not null
          and callback.provider_queued_at <= p_stale_before
        )
      )
      and (
        callback.last_reconciliation_at is null
        or callback.last_reconciliation_at <= p_cooldown_before
      )
      and (
        callback.reconciliation_claimed_at is null
        or callback.reconciliation_claimed_at <= p_claim_before
      )
      and (
        callback.reconciliation_not_before is null
        or callback.reconciliation_not_before <= v_now
      )
    order by
      (callback.expires_at <= v_now) desc,
      callback.last_reconciliation_at asc nulls first,
      callback.provider_queued_at asc nulls first
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.apollo_enrichment_callbacks callback
    set reconciliation_attempt_count = callback.reconciliation_attempt_count + 1,
        last_reconciliation_at = v_now,
        reconciliation_claimed_at = v_now,
        reconciliation_last_error_code = null,
        updated_at = v_now
    from candidates
    where callback.id = candidates.id
    returning
      callback.id,
      callback.token_hash,
      callback.provider_request_id,
      callback.apollo_person_id,
      callback.expires_at,
      callback.reconciliation_claimed_at,
      callback.reconciliation_attempt_count
  )
  select
    claimed.id,
    claimed.token_hash,
    claimed.provider_request_id,
    claimed.apollo_person_id,
    claimed.expires_at,
    claimed.reconciliation_claimed_at,
    claimed.reconciliation_attempt_count
  from claimed;
end;
$$;

create or replace function public.release_apollo_enrichment_reconciliation_candidates_v1(
  p_callback_ids uuid[],
  p_claimed_at timestamptz,
  p_error_code text default null,
  p_retry_after_seconds integer default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback_ids uuid[];
  v_error_code text := nullif(trim(coalesce(p_error_code, '')), '');
  v_updated_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_callback_ids is null or cardinality(p_callback_ids) = 0
    or cardinality(p_callback_ids) > 100 or array_position(p_callback_ids, null) is not null
    or p_claimed_at is null
    or (v_error_code is not null and char_length(v_error_code) > 100)
    or (p_retry_after_seconds is not null and p_retry_after_seconds not between 1 and 86400) then
    raise exception 'invalid reconciliation release input' using errcode = '22023';
  end if;

  select array_agg(distinct ids.callback_id)
  into v_callback_ids
  from unnest(p_callback_ids) as ids(callback_id);

  update public.apollo_enrichment_callbacks callback
  set reconciliation_claimed_at = null,
      reconciliation_not_before = case
        when p_retry_after_seconds is null then null
        else now() + make_interval(secs => p_retry_after_seconds)
      end,
      reconciliation_last_error_code = v_error_code,
      updated_at = now()
  where callback.id = any(v_callback_ids)
    and callback.reconciliation_claimed_at = p_claimed_at;
  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

revoke all on function public.settle_apollo_enrichment_quota_if_ready_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.settle_apollo_enrichment_quota_if_ready_v1(uuid)
  to service_role;
revoke all on function public.apply_apollo_enrichment_callback_v1(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_apollo_enrichment_callback_v1(text, text, text, text, jsonb)
  to service_role;
revoke all on function public.settle_apollo_enrichment_callback_v1(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_apollo_enrichment_callback_v1(uuid, text, text)
  to service_role;
revoke all on function public.claim_apollo_enrichment_reconciliation_candidates_v1(integer, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_apollo_enrichment_reconciliation_candidates_v1(integer, timestamptz, timestamptz, timestamptz)
  to service_role;
revoke all on function public.release_apollo_enrichment_reconciliation_candidates_v1(uuid[], timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.release_apollo_enrichment_reconciliation_candidates_v1(uuid[], timestamptz, text, integer)
  to service_role;

notify pgrst, 'reload schema';
