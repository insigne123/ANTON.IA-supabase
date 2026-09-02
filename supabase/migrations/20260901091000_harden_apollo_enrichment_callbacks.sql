-- Convert the unused legacy Apollo callback table into a tenant-safe state
-- machine. Existing terminal rows are retained and normalized in place.
alter table public.apollo_enrichment_callbacks
  drop constraint if exists apollo_enrichment_callbacks_status_check,
  drop constraint if exists apollo_enrichment_callbacks_target_table_check,
  drop constraint if exists apollo_enrichment_callbacks_idempotency_key_key;

alter table public.apollo_enrichment_callbacks
  alter column apollo_person_id drop not null,
  add column if not exists quota_resource text not null default 'enrich',
  add column if not exists requested_fields text[],
  add column if not exists terminal_state text,
  add column if not exists provider_status text,
  add column if not exists delivery_count integer not null default 0,
  add column if not exists last_delivery_at timestamptz,
  add column if not exists terminal_at timestamptz,
  add column if not exists reconciliation_attempt_count integer not null default 0,
  add column if not exists last_reconciliation_at timestamptz,
  add column if not exists reconciliation_claimed_at timestamptz,
  add column if not exists reconciliation_not_before timestamptz,
  add column if not exists reconciliation_last_error_code text,
  add column if not exists privacy_subject_hash text;

update public.apollo_enrichment_callbacks
set requested_fields = case
      when reveal_email and reveal_phone then array['person.email', 'person.phone_numbers']::text[]
      when reveal_phone then array['person.phone_numbers']::text[]
      else array['person.email']::text[]
    end
where requested_fields is null;

update public.apollo_enrichment_callbacks
set terminal_state = case status
      when 'completed' then 'succeeded'
      when 'no_phone' then 'no_data'
      when 'failed' then 'failed'
      when 'expired' then 'expired'
      else terminal_state
    end,
    terminal_at = case
      when status in ('completed', 'no_phone', 'failed', 'expired')
        then coalesce(processed_at, updated_at, created_at, now())
      else terminal_at
    end,
    status = case
      when status in ('completed', 'no_phone', 'failed', 'expired') then 'terminal'
      else status
    end;

update public.apollo_enrichment_callbacks
set payload_hash = null
where payload_hash is not null
  and payload_hash !~ '^[0-9a-f]{64}$';

-- Legacy rows could predate target-level uniqueness. Preserve one active row
-- and settle older duplicates before creating the partial unique index.
with ranked as (
  select
    callback.id,
    row_number() over (
      partition by callback.target_table, callback.target_lead_id
      order by
        (callback.delivery_count > 0) desc,
        (callback.provider_request_id is not null) desc,
        (callback.provider_queued_at is not null) desc,
        callback.created_at,
        callback.id
    ) as position
  from public.apollo_enrichment_callbacks callback
  where callback.status in ('pending', 'processing')
)
update public.apollo_enrichment_callbacks callback
set status = 'terminal',
    terminal_state = 'cancelled',
    terminal_at = coalesce(callback.updated_at, callback.created_at, now()),
    last_error_code = 'legacy_duplicate_active_target',
    updated_at = now()
from ranked
where callback.id = ranked.id
  and ranked.position > 1;

alter table public.apollo_enrichment_callbacks
  alter column requested_fields set not null,
  add constraint apollo_enrichment_callbacks_status_v2_check
    check (status in ('pending', 'processing', 'terminal')),
  add constraint apollo_enrichment_callbacks_terminal_state_check
    check (terminal_state is null or terminal_state in ('succeeded', 'no_data', 'failed', 'cancelled', 'expired')),
  add constraint apollo_enrichment_callbacks_state_v2_check
    check (
      (status = 'terminal' and terminal_state is not null and terminal_at is not null)
      or (status <> 'terminal' and terminal_state is null and terminal_at is null)
    ),
  add constraint apollo_enrichment_callbacks_target_table_v2_check
    check (target_table in ('people_search_leads', 'enriched_leads', 'enriched_opportunities')),
  add constraint apollo_enrichment_callbacks_quota_resource_check
    check (quota_resource in ('enrich', 'investigate')),
  add constraint apollo_enrichment_callbacks_requested_fields_check
    check (
      cardinality(requested_fields) > 0
      and array_position(requested_fields, null) is null
      and requested_fields <@ array['person.email', 'person.phone_numbers']::text[]
    ),
  add constraint apollo_enrichment_callbacks_token_hash_format_check
    check (token_hash ~ '^[0-9a-f]{64}$') not valid,
  add constraint apollo_enrichment_callbacks_payload_hash_format_check
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  add constraint apollo_enrichment_callbacks_delivery_count_check
    check (delivery_count >= 0),
  add constraint apollo_enrichment_callbacks_reconciliation_attempt_count_check
    check (reconciliation_attempt_count >= 0),
  add constraint apollo_enrichment_callbacks_apollo_person_id_check
    check (
      apollo_person_id is null
      or char_length(trim(apollo_person_id)) between 1 and 255
    ) not valid,
  add constraint apollo_enrichment_callbacks_provider_request_id_check
    check (
      provider_request_id is null
      or char_length(trim(provider_request_id)) between 1 and 255
    ) not valid,
  add constraint apollo_enrichment_callbacks_provider_status_check
    check (
      provider_status is null
      or char_length(trim(provider_status)) between 1 and 64
    ),
  add constraint apollo_enrichment_callbacks_operation_id_check
    check (char_length(trim(operation_id)) between 1 and 200) not valid,
  add constraint apollo_enrichment_callbacks_idempotency_key_check
    check (char_length(trim(idempotency_key)) between 1 and 255) not valid,
  add constraint apollo_enrichment_callbacks_target_id_check
    check (char_length(trim(target_lead_id)) between 1 and 255) not valid,
  add constraint apollo_enrichment_callbacks_last_error_code_check
    check (
      last_error_code is null
      or char_length(trim(last_error_code)) between 1 and 100
    ) not valid,
  add constraint apollo_enrichment_callbacks_reconciliation_error_check
    check (
      reconciliation_last_error_code is null
      or char_length(trim(reconciliation_last_error_code)) between 1 and 100
    ),
  add constraint apollo_enrichment_callbacks_privacy_subject_hash_check
    check (privacy_subject_hash is null or privacy_subject_hash ~ '^[0-9a-f]{64}$') not valid;

create unique index if not exists apollo_enrichment_callbacks_scoped_idempotency_key
  on public.apollo_enrichment_callbacks (organization_id, user_id, idempotency_key);

create index if not exists apollo_enrichment_callbacks_operation_target_idx
  on public.apollo_enrichment_callbacks (
    organization_id,
    user_id,
    quota_resource,
    operation_id,
    target_table,
    target_lead_id
  );

create unique index if not exists apollo_enrichment_callbacks_active_target_key
  on public.apollo_enrichment_callbacks (target_table, target_lead_id)
  where status in ('pending', 'processing');

create index if not exists apollo_enrichment_callbacks_reconciliation_idx
  on public.apollo_enrichment_callbacks (
    last_reconciliation_at asc nulls first,
    created_at,
    provider_request_id
  )
  where status in ('pending', 'processing');

create index if not exists apollo_enrichment_callbacks_privacy_subject_hash_idx
  on public.apollo_enrichment_callbacks (privacy_subject_hash)
  where privacy_subject_hash is not null;

revoke all on table public.apollo_enrichment_callbacks
  from public, anon, authenticated;
grant all on table public.apollo_enrichment_callbacks to service_role;

drop policy if exists "Apollo callbacks are service role only"
  on public.apollo_enrichment_callbacks;
create policy "Apollo callbacks are service role only"
  on public.apollo_enrichment_callbacks
  for all
  to service_role
  using (true)
  with check (true);

-- Callback creation verifies both the quota operation and the persisted target
-- before any provider request can cross the network boundary.
create or replace function public.create_apollo_enrichment_callback_v1(
  p_user_id uuid,
  p_organization_id uuid,
  p_quota_resource text,
  p_target_table text,
  p_target_id text,
  p_apollo_person_id text,
  p_token_hash text,
  p_idempotency_key text,
  p_operation_id text,
  p_claim_token uuid,
  p_requested_fields text[],
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target_table text := trim(coalesce(p_target_table, ''));
  v_target_id text := trim(coalesce(p_target_id, ''));
  v_apollo_person_id text := nullif(trim(coalesce(p_apollo_person_id, '')), '');
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_idempotency_key text := trim(coalesce(p_idempotency_key, ''));
  v_operation_id text := trim(coalesce(p_operation_id, ''));
  v_existing public.apollo_enrichment_callbacks%rowtype;
  v_callback_id uuid;
  v_target_email text;
  v_target_status text;
  v_privacy_subject_hash text;
  v_active_callback_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_user_id is null or p_organization_id is null or p_claim_token is null then
    raise exception 'callback ownership is required' using errcode = '22023';
  end if;
  if p_quota_resource not in ('enrich', 'investigate') then
    raise exception 'invalid quota resource' using errcode = '22023';
  end if;
  if v_target_table not in ('people_search_leads', 'enriched_leads', 'enriched_opportunities')
    or char_length(v_target_id) not between 1 and 255 then
    raise exception 'invalid callback target' using errcode = '22023';
  end if;
  if v_apollo_person_id is not null and char_length(v_apollo_person_id) > 255 then
    raise exception 'invalid Apollo person id' using errcode = '22023';
  end if;
  if v_token_hash !~ '^[0-9a-f]{64}$'
    or char_length(v_idempotency_key) not between 1 and 255
    or char_length(v_operation_id) not between 1 and 200 then
    raise exception 'invalid callback identity' using errcode = '22023';
  end if;
  if p_requested_fields is null or cardinality(p_requested_fields) = 0
    or array_position(p_requested_fields, null) is not null
    or not (p_requested_fields <@ array['person.email', 'person.phone_numbers']::text[]) then
    raise exception 'invalid requested fields' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'invalid callback expiry' using errcode = '22023';
  end if;

  perform 1
  from public.antonia_quota_operations operation
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = p_quota_resource
    and operation.operation_id = v_operation_id
    and operation.status = 'claimed'
    and operation.claim_token = p_claim_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'quota_claim_not_owned');
  end if;

  if v_target_table = 'enriched_leads' then
    select target.email, target.enrichment_status
    into v_target_email, v_target_status
    from public.enriched_leads target
    where target.id = v_target_id
      and target.user_id = p_user_id
      and target.organization_id = p_organization_id
    for update;
  elsif v_target_table = 'enriched_opportunities' then
    select target.email, target.enrichment_status
    into v_target_email, v_target_status
    from public.enriched_opportunities target
    where target.id::text = v_target_id
      and target.user_id = p_user_id
      and target.organization_id = p_organization_id
    for update;
  else
    select target.email, target.enrichment_status
    into v_target_email, v_target_status
    from public.people_search_leads target
    where target.id = v_target_id
      and target.user_id = p_user_id
      and target.organization_id = p_organization_id::text
    for update;
  end if;
  if not found then
    return jsonb_build_object('outcome', 'target_not_found');
  end if;
  if lower(coalesce(v_target_status, '')) = 'suppressed' then
    return jsonb_build_object('outcome', 'target_suppressed');
  end if;

  if nullif(trim(coalesce(v_target_email, '')), '') is not null then
    v_privacy_subject_hash := encode(
      extensions.digest(convert_to(lower(trim(v_target_email)), 'UTF8'), 'sha256'),
      'hex'
    );
  end if;

  select * into v_existing
  from public.apollo_enrichment_callbacks callback
  where callback.organization_id = p_organization_id
    and callback.user_id = p_user_id
    and callback.idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.operation_id <> v_operation_id
      or v_existing.target_table <> v_target_table
      or v_existing.target_lead_id <> v_target_id
      or v_existing.requested_fields <> p_requested_fields then
      return jsonb_build_object('outcome', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'outcome', 'replay',
      'callbackId', v_existing.id,
      'status', v_existing.status,
      'terminalState', v_existing.terminal_state
    );
  end if;

  select callback.id into v_active_callback_id
  from public.apollo_enrichment_callbacks callback
  where callback.target_table = v_target_table
    and callback.target_lead_id = v_target_id
    and callback.status in ('pending', 'processing')
  limit 1;
  if v_active_callback_id is not null then
    return jsonb_build_object('outcome', 'target_busy', 'callbackId', v_active_callback_id);
  end if;

  begin
    insert into public.apollo_enrichment_callbacks (
      user_id,
      organization_id,
      target_table,
      target_lead_id,
      apollo_person_id,
      token_hash,
      idempotency_key,
      operation_id,
      quota_resource,
      requested_fields,
      reveal_email,
      reveal_phone,
      expires_at,
      privacy_subject_hash
    ) values (
      p_user_id,
      p_organization_id,
      v_target_table,
      v_target_id,
      v_apollo_person_id,
      v_token_hash,
      v_idempotency_key,
      v_operation_id,
      p_quota_resource,
      p_requested_fields,
      'person.email' = any(p_requested_fields),
      'person.phone_numbers' = any(p_requested_fields),
      p_expires_at,
      v_privacy_subject_hash
    )
    returning id into v_callback_id;
  exception when unique_violation then
    select * into v_existing
    from public.apollo_enrichment_callbacks callback
    where callback.organization_id = p_organization_id
      and callback.user_id = p_user_id
      and callback.idempotency_key = v_idempotency_key;
    if found
      and v_existing.operation_id = v_operation_id
      and v_existing.target_table = v_target_table
      and v_existing.target_lead_id = v_target_id
      and v_existing.requested_fields = p_requested_fields then
      return jsonb_build_object(
        'outcome', 'replay',
        'callbackId', v_existing.id,
        'status', v_existing.status,
        'terminalState', v_existing.terminal_state
      );
    end if;
    if exists (
      select 1
      from public.apollo_enrichment_callbacks callback
      where callback.target_table = v_target_table
        and callback.target_lead_id = v_target_id
        and callback.status in ('pending', 'processing')
    ) then
      return jsonb_build_object('outcome', 'target_busy');
    end if;
    raise;
  end;

  return jsonb_build_object('outcome', 'created', 'callbackId', v_callback_id);
end;
$$;

-- This transition is committed before the HTTP request to Apollo. A retry that
-- finds this state must report an unknown provider outcome instead of submitting
-- a second chargeable request.
create or replace function public.mark_apollo_enrichment_callback_submitted_v1(
  p_callback_id uuid,
  p_token_hash text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_now timestamptz := now();
  v_target_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_callback_id is null or p_claim_token is null or v_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid callback submission' using errcode = '22023';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id;

  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;

  perform 1
  from public.antonia_quota_operations operation
  where operation.organization_id = v_callback.organization_id
    and operation.user_id = v_callback.user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_callback.operation_id
    and operation.status in ('claimed', 'submitted')
    and operation.claim_token = p_claim_token
    and operation.quota_allowed
  for update;
  if not found then
    return jsonb_build_object('outcome', 'quota_claim_not_owned');
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id
    and callback.organization_id = v_callback.organization_id
    and callback.user_id = v_callback.user_id
    and callback.quota_resource = v_callback.quota_resource
    and callback.operation_id = v_callback.operation_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  if v_callback.token_hash <> v_token_hash then
    return jsonb_build_object('outcome', 'token_mismatch');
  end if;
  if v_callback.status = 'terminal' then
    return jsonb_build_object('outcome', 'terminal', 'terminalState', v_callback.terminal_state);
  end if;
  if v_callback.provider_queued_at is not null then
    return jsonb_build_object('outcome', 'provider_outcome_unknown');
  end if;
  if v_callback.expires_at <= v_now then
    return jsonb_build_object('outcome', 'expired');
  end if;

  if v_callback.target_table = 'enriched_leads' then
    select target.enrichment_status into v_target_status
    from public.enriched_leads target
    where target.id = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id
    for update;
  elsif v_callback.target_table = 'enriched_opportunities' then
    select target.enrichment_status into v_target_status
    from public.enriched_opportunities target
    where target.id::text = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id
    for update;
  else
    select target.enrichment_status into v_target_status
    from public.people_search_leads target
    where target.id = v_callback.target_lead_id
      and target.user_id = v_callback.user_id
      and target.organization_id = v_callback.organization_id::text
    for update;
  end if;
  if not found then
    return jsonb_build_object('outcome', 'target_not_found');
  end if;
  if lower(coalesce(v_target_status, '')) = 'suppressed' then
    return jsonb_build_object('outcome', 'target_suppressed');
  end if;

  update public.antonia_quota_operations operation
  set status = 'submitted',
      submitted_at = coalesce(operation.submitted_at, v_now),
      updated_at = v_now
  where operation.organization_id = v_callback.organization_id
    and operation.user_id = v_callback.user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_callback.operation_id
    and operation.status in ('claimed', 'submitted')
    and operation.claim_token = p_claim_token
    and operation.quota_allowed;

  update public.apollo_enrichment_callbacks callback
  set status = 'processing',
      provider_queued_at = v_now,
      updated_at = v_now
  where callback.id = v_callback.id;

  return jsonb_build_object('outcome', 'submitted');
end;
$$;

-- Match-only profile lookup has no contact callback, but it still crosses the
-- same quota and privacy boundary under a locked tenant target.
create or replace function public.mark_apollo_match_operation_submitted_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_quota_resource text,
  p_operation_id text,
  p_claim_token uuid,
  p_target_table text,
  p_target_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_operation_id text := trim(coalesce(p_operation_id, ''));
  v_target_table text := trim(coalesce(p_target_table, ''));
  v_target_id text := trim(coalesce(p_target_id, ''));
  v_operation_status text;
  v_target_status text;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_user_id is null or p_claim_token is null
    or p_quota_resource not in ('enrich', 'investigate')
    or char_length(v_operation_id) not between 1 and 200
    or v_target_table not in ('people_search_leads', 'enriched_leads', 'enriched_opportunities')
    or char_length(v_target_id) not between 1 and 255 then
    raise exception 'invalid Apollo match submission' using errcode = '22023';
  end if;

  select operation.status into v_operation_status
  from public.antonia_quota_operations operation
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = p_quota_resource
    and operation.operation_id = v_operation_id
    and operation.status in ('claimed', 'submitted')
    and operation.claim_token = p_claim_token
    and operation.quota_allowed
  for update;
  if not found then
    return jsonb_build_object('outcome', 'quota_claim_not_owned');
  end if;

  if v_target_table = 'enriched_leads' then
    select target.enrichment_status into v_target_status
    from public.enriched_leads target
    where target.id = v_target_id
      and target.user_id = p_user_id
      and target.organization_id = p_organization_id
    for update;
  elsif v_target_table = 'enriched_opportunities' then
    select target.enrichment_status into v_target_status
    from public.enriched_opportunities target
    where target.id::text = v_target_id
      and target.user_id = p_user_id
      and target.organization_id = p_organization_id
    for update;
  else
    select target.enrichment_status into v_target_status
    from public.people_search_leads target
    where target.id = v_target_id
      and target.user_id = p_user_id
      and target.organization_id = p_organization_id::text
    for update;
  end if;
  if not found then
    return jsonb_build_object('outcome', 'target_not_found');
  end if;
  if lower(coalesce(v_target_status, '')) = 'suppressed' then
    return jsonb_build_object('outcome', 'target_suppressed');
  end if;

  if v_operation_status = 'claimed' then
    update public.antonia_quota_operations operation
    set status = 'submitted',
        submitted_at = coalesce(operation.submitted_at, v_now),
        updated_at = v_now
    where operation.organization_id = p_organization_id
      and operation.user_id = p_user_id
      and operation.resource = p_quota_resource
      and operation.operation_id = v_operation_id
      and operation.status = 'claimed'
      and operation.claim_token = p_claim_token
      and operation.quota_allowed;
    if not found then
      return jsonb_build_object('outcome', 'quota_claim_not_owned');
    end if;
  end if;
  return jsonb_build_object('outcome', 'submitted');
end;
$$;

create or replace function public.bind_apollo_enrichment_callback_v1(
  p_callback_id uuid,
  p_provider_request_id text,
  p_apollo_person_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_provider_request_id text := trim(coalesce(p_provider_request_id, ''));
  v_apollo_person_id text := nullif(trim(coalesce(p_apollo_person_id, '')), '');
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_callback_id is null or char_length(v_provider_request_id) not between 1 and 255
    or (v_apollo_person_id is not null and char_length(v_apollo_person_id) > 255) then
    raise exception 'invalid callback binding' using errcode = '22023';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  if v_callback.provider_request_id is not null
    and v_callback.provider_request_id <> v_provider_request_id then
    return jsonb_build_object('outcome', 'provider_request_mismatch');
  end if;
  if v_callback.apollo_person_id is not null and v_apollo_person_id is not null
    and v_callback.apollo_person_id <> v_apollo_person_id then
    return jsonb_build_object('outcome', 'apollo_person_mismatch');
  end if;

  update public.apollo_enrichment_callbacks callback
  set provider_request_id = coalesce(callback.provider_request_id, v_provider_request_id),
      apollo_person_id = coalesce(callback.apollo_person_id, v_apollo_person_id),
      status = case when callback.status = 'pending' then 'processing' else callback.status end,
      updated_at = v_now
  where callback.id = v_callback.id;

  return jsonb_build_object('outcome', 'bound');
end;
$$;

revoke all on function public.create_apollo_enrichment_callback_v1(uuid, uuid, text, text, text, text, text, text, text, uuid, text[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_apollo_enrichment_callback_v1(uuid, uuid, text, text, text, text, text, text, text, uuid, text[], timestamptz)
  to service_role;
revoke all on function public.mark_apollo_enrichment_callback_submitted_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_apollo_enrichment_callback_submitted_v1(uuid, text, uuid)
  to service_role;
revoke all on function public.mark_apollo_match_operation_submitted_v1(uuid, uuid, text, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_apollo_match_operation_submitted_v1(uuid, uuid, text, text, uuid, text, text)
  to service_role;
revoke all on function public.bind_apollo_enrichment_callback_v1(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.bind_apollo_enrichment_callback_v1(uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
