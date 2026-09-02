-- FullEnrich delivers one callback per contact. The callback UUID is the only
-- value placed in FullEnrich custom data; target ownership remains server-side.
create table if not exists public.fullenrich_enrichment_callbacks (
  callback_id uuid primary key default gen_random_uuid(),
  provider_enrichment_id text,
  operation_id text not null check (char_length(trim(operation_id)) between 1 and 200),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quota_resource text not null default 'enrich' check (quota_resource in ('enrich', 'investigate')),
  target_table text not null check (
    target_table in ('enriched_leads', 'enriched_opportunities', 'people_search_leads')
  ),
  target_id text not null check (char_length(trim(target_id)) between 1 and 255),
  requested_fields text[] not null check (
    cardinality(requested_fields) > 0
    and array_position(requested_fields, null) is null
    and requested_fields <@ array[
      'contact.work_emails',
      'contact.phones'
    ]::text[]
  ),
  status text not null default 'pending' check (status in ('pending', 'processing', 'terminal')),
  terminal_state text check (terminal_state in ('succeeded', 'no_data', 'failed', 'cancelled')),
  provider_status text,
  payload_fingerprint text check (
    payload_fingerprint is null or payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  delivery_count integer not null default 0 check (delivery_count >= 0),
  last_delivery_at timestamptz,
  terminal_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'terminal' and terminal_state is not null and terminal_at is not null)
    or (status <> 'terminal' and terminal_state is null and terminal_at is null)
  ),
  check (
    provider_enrichment_id is null
    or char_length(trim(provider_enrichment_id)) between 1 and 200
  ),
  check (
    provider_status is null
    or char_length(trim(provider_status)) between 1 and 64
  ),
  check (
    last_error_code is null
    or char_length(trim(last_error_code)) between 1 and 100
  )
);

create index if not exists fullenrich_enrichment_callbacks_provider_idx
  on public.fullenrich_enrichment_callbacks (provider_enrichment_id)
  where provider_enrichment_id is not null;

create index if not exists fullenrich_enrichment_callbacks_operation_idx
  on public.fullenrich_enrichment_callbacks (operation_id, status);

create index if not exists fullenrich_enrichment_callbacks_target_idx
  on public.fullenrich_enrichment_callbacks (target_table, target_id);

-- One target can be part of a single operation, and cannot be submitted to a
-- second FullEnrich batch until its first callback becomes terminal.
create unique index if not exists fullenrich_enrichment_callbacks_operation_target_key
  on public.fullenrich_enrichment_callbacks (operation_id, quota_resource, target_table, target_id);

create unique index if not exists fullenrich_enrichment_callbacks_active_target_key
  on public.fullenrich_enrichment_callbacks (target_table, target_id)
  where status in ('pending', 'processing');

alter table public.fullenrich_enrichment_callbacks enable row level security;
revoke all on table public.fullenrich_enrichment_callbacks from public, anon, authenticated;
grant all on table public.fullenrich_enrichment_callbacks to service_role;

create policy "FullEnrich callbacks are service role only"
  on public.fullenrich_enrichment_callbacks
  for all
  to service_role
  using (true)
  with check (true);

-- Binds callbacks created before POST /contact/enrich/bulk to the provider's
-- batch ID. It refuses to overwrite a callback already bound to another batch.
create or replace function public.bind_fullenrich_enrichment_callbacks_v1(
  p_callback_ids uuid[],
  p_provider_enrichment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback_ids uuid[];
  v_provider_enrichment_id text := nullif(trim(coalesce(p_provider_enrichment_id, '')), '');
  v_found_count integer;
  v_mismatch_count integer;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_provider_enrichment_id is null or char_length(v_provider_enrichment_id) > 200 then
    raise exception 'invalid provider enrichment id' using errcode = '22023';
  end if;

  if p_callback_ids is null or cardinality(p_callback_ids) = 0
    or cardinality(p_callback_ids) > 100 or array_position(p_callback_ids, null) is not null then
    raise exception 'invalid callback ids' using errcode = '22023';
  end if;

  select array_agg(distinct ids.callback_id)
  into v_callback_ids
  from unnest(p_callback_ids) as ids(callback_id);

  perform 1
  from public.fullenrich_enrichment_callbacks callback
  where callback.callback_id = any(v_callback_ids)
  for update;

  select count(*)
  into v_found_count
  from public.fullenrich_enrichment_callbacks callback
  where callback.callback_id = any(v_callback_ids);

  if v_found_count <> cardinality(v_callback_ids) then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;

  select count(*)
  into v_mismatch_count
  from public.fullenrich_enrichment_callbacks callback
  where callback.callback_id = any(v_callback_ids)
    and callback.provider_enrichment_id is not null
    and callback.provider_enrichment_id <> v_provider_enrichment_id;

  if v_mismatch_count > 0 then
    return jsonb_build_object('outcome', 'provider_enrichment_mismatch');
  end if;

  update public.fullenrich_enrichment_callbacks callback
  set provider_enrichment_id = v_provider_enrichment_id,
      status = case when callback.status = 'pending' then 'processing' else callback.status end,
      last_error_code = null,
      updated_at = v_now
  where callback.callback_id = any(v_callback_ids);

  return jsonb_build_object('outcome', 'bound', 'count', cardinality(v_callback_ids));
end;
$$;

-- This is the only write boundary used by the webhook. It locks the callback
-- first, then derives both the target and the allowed fields from persisted
-- server-side metadata rather than the provider payload.
create or replace function public.apply_fullenrich_enrichment_callback_v1(
  p_callback_id uuid,
  p_provider_enrichment_id text,
  p_provider_status text,
  p_payload_fingerprint text,
  p_candidate jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.fullenrich_enrichment_callbacks%rowtype;
  v_provider_enrichment_id text := nullif(trim(coalesce(p_provider_enrichment_id, '')), '');
  v_provider_status text := upper(nullif(trim(coalesce(p_provider_status, '')), ''));
  v_now timestamptz := now();
  v_requests_work_email boolean;
  v_requests_phone boolean;
  v_email text;
  v_email_status text;
  v_phone_numbers jsonb := '[]'::jsonb;
  v_primary_phone text;
  v_has_phone boolean := false;
  v_terminal_state text;
  v_target_count integer := 0;
  v_outcome text := 'processed';
  v_remaining_callbacks integer := 0;
  v_quota_claim_token uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_callback_id is null then
    raise exception 'callback id is required' using errcode = '22023';
  end if;
  if v_provider_enrichment_id is null or char_length(v_provider_enrichment_id) > 200 then
    raise exception 'invalid provider enrichment id' using errcode = '22023';
  end if;
  if v_provider_status is null or char_length(v_provider_status) > 64 then
    raise exception 'invalid provider status' using errcode = '22023';
  end if;
  if coalesce(p_payload_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid payload fingerprint' using errcode = '22023';
  end if;
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'invalid enrichment candidate' using errcode = '22023';
  end if;
  if (p_candidate ? 'work_email' and jsonb_typeof(p_candidate -> 'work_email') <> 'object')
    or (p_candidate ? 'phone_numbers' and jsonb_typeof(p_candidate -> 'phone_numbers') <> 'array') then
    raise exception 'invalid enrichment candidate' using errcode = '22023';
  end if;

  select *
  into v_callback
  from public.fullenrich_enrichment_callbacks callback
  where callback.callback_id = p_callback_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;

  update public.fullenrich_enrichment_callbacks callback
  set delivery_count = callback.delivery_count + 1,
      last_delivery_at = v_now,
      provider_status = v_provider_status,
      payload_fingerprint = p_payload_fingerprint,
      updated_at = v_now
  where callback.callback_id = v_callback.callback_id;

  if v_callback.terminal_state is not null then
    return jsonb_build_object('outcome', 'duplicate', 'terminalState', v_callback.terminal_state);
  end if;

  if v_callback.provider_enrichment_id is not null
    and v_callback.provider_enrichment_id <> v_provider_enrichment_id then
    update public.fullenrich_enrichment_callbacks callback
    set last_error_code = 'provider_enrichment_mismatch',
        updated_at = v_now
    where callback.callback_id = v_callback.callback_id;

    return jsonb_build_object('outcome', 'provider_enrichment_mismatch');
  end if;

  v_requests_work_email := 'contact.work_emails' = any(v_callback.requested_fields);
  v_requests_phone := 'contact.phones' = any(v_callback.requested_fields);

  if v_requests_work_email then
    v_email := nullif(trim(coalesce(p_candidate #>> '{work_email,email}', '')), '');
    v_email_status := nullif(trim(coalesce(p_candidate #>> '{work_email,status}', '')), '');
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

  if v_requests_phone and p_candidate ? 'phone_numbers' then
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
    if v_primary_phone is null then
      v_primary_phone := nullif(trim(coalesce(v_phone_numbers -> 0 ->> 'sanitized_number', '')), '');
    end if;
    if v_primary_phone is not null and char_length(v_primary_phone) > 64 then
      v_primary_phone := null;
    end if;
  end if;

  v_terminal_state := case
    when v_provider_status = 'CANCELED' then 'cancelled'
    when v_provider_status in ('CREDITS_INSUFFICIENT', 'RATE_LIMIT', 'UNKNOWN') then 'failed'
    when v_email is not null or v_has_phone then 'succeeded'
    else 'no_data'
  end;

  -- Failed, cancelled, and empty outcomes only change enrichment state. They
  -- never replace existing target data with a provider's incomplete payload.
  if v_terminal_state <> 'succeeded' then
    v_email := null;
    v_email_status := null;
    v_phone_numbers := '[]'::jsonb;
    v_primary_phone := null;
    v_has_phone := false;
  end if;

  if v_callback.target_table = 'enriched_leads' then
    update public.enriched_leads target
    set email = case when v_email is null then target.email else v_email end,
        email_status = case when v_email_status is null then target.email_status else v_email_status end,
        phone_numbers = case when v_has_phone then v_phone_numbers else target.phone_numbers end,
        primary_phone = case when v_primary_phone is null then target.primary_phone else v_primary_phone end,
        enrichment_status = case when v_terminal_state = 'succeeded' then 'completed' else 'failed' end,
        updated_at = v_now
    where target.id = v_callback.target_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id;
    get diagnostics v_target_count = row_count;
  elsif v_callback.target_table = 'enriched_opportunities' then
    update public.enriched_opportunities target
    set email = case when v_email is null then target.email else v_email end,
        email_status = case when v_email_status is null then target.email_status else v_email_status end,
        phone_numbers = case when v_has_phone then v_phone_numbers else target.phone_numbers end,
        primary_phone = case when v_primary_phone is null then target.primary_phone else v_primary_phone end,
        enrichment_status = case when v_terminal_state = 'succeeded' then 'completed' else 'failed' end,
        updated_at = v_now
    where target.id::text = v_callback.target_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id;
    get diagnostics v_target_count = row_count;
  elsif v_callback.target_table = 'people_search_leads' then
    update public.people_search_leads target
    set email = case when v_email is null then target.email else v_email end,
        email_status = case when v_email_status is null then target.email_status else v_email_status end,
        phone_numbers = case when v_has_phone then v_phone_numbers else target.phone_numbers end,
        primary_phone = case when v_primary_phone is null then target.primary_phone else v_primary_phone end,
        enrichment_status = case when v_terminal_state = 'succeeded' then 'completed' else 'failed' end,
        updated_at = v_now
    where target.id = v_callback.target_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id::text;
    get diagnostics v_target_count = row_count;
  else
    raise exception 'unsupported callback target' using errcode = '22023';
  end if;

  if v_target_count = 0 then
    update public.fullenrich_enrichment_callbacks callback
    set provider_enrichment_id = coalesce(callback.provider_enrichment_id, v_provider_enrichment_id),
        status = 'terminal',
        terminal_state = 'failed',
        terminal_at = v_now,
        last_error_code = 'target_not_found',
        updated_at = v_now
    where callback.callback_id = v_callback.callback_id;
    v_terminal_state := 'failed';
    v_outcome := 'target_not_found';
  else
    update public.fullenrich_enrichment_callbacks callback
    set provider_enrichment_id = coalesce(callback.provider_enrichment_id, v_provider_enrichment_id),
        status = 'terminal',
        terminal_state = v_terminal_state,
        terminal_at = v_now,
        last_error_code = null,
        updated_at = v_now
    where callback.callback_id = v_callback.callback_id;
  end if;

  -- Serializing on the quota row means two final contact callbacks cannot both
  -- observe the other as pending and leave the operation submitted forever.
  select operation.claim_token
  into v_quota_claim_token
  from public.antonia_quota_operations operation
  where operation.organization_id = v_callback.organization_id
    and operation.user_id = v_callback.user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_callback.operation_id
    and operation.status = 'submitted'
  for update;

  if v_quota_claim_token is not null then
    select count(*)
    into v_remaining_callbacks
    from public.fullenrich_enrichment_callbacks callback
    where callback.organization_id = v_callback.organization_id
      and callback.user_id = v_callback.user_id
      and callback.quota_resource = v_callback.quota_resource
      and callback.operation_id = v_callback.operation_id
      and callback.status <> 'terminal';

    if v_remaining_callbacks = 0 then
      perform public.complete_antonia_quota_operation_v1(
        v_callback.organization_id,
        v_callback.user_id,
        v_callback.quota_resource,
        v_callback.operation_id,
        v_quota_claim_token,
        'completed',
        202,
        jsonb_build_object(
          'queued', true,
          'provider', 'fullenrich',
          'operationId', v_callback.operation_id,
          'operationStatus', 'completed'
        )
      );
    end if;
  end if;

  return jsonb_build_object('outcome', v_outcome, 'terminalState', v_terminal_state);
end;
$$;

revoke all on function public.bind_fullenrich_enrichment_callbacks_v1(uuid[], text)
  from public, anon, authenticated;
grant execute on function public.bind_fullenrich_enrichment_callbacks_v1(uuid[], text)
  to service_role;

revoke all on function public.apply_fullenrich_enrichment_callback_v1(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_fullenrich_enrichment_callback_v1(uuid, text, text, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
