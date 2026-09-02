-- A stale quota claim may be reacquired after a process crash. Only callbacks
-- that never crossed the provider boundary may rotate their opaque token.
create or replace function public.replace_unsubmitted_apollo_callback_v1(
  p_callback_id uuid,
  p_user_id uuid,
  p_organization_id uuid,
  p_operation_id text,
  p_claim_token uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_callback public.apollo_enrichment_callbacks%rowtype;
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_operation_id text := trim(coalesce(p_operation_id, ''));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_callback_id is null or p_user_id is null or p_organization_id is null or p_claim_token is null
    or v_token_hash !~ '^[0-9a-f]{64}$'
    or char_length(v_operation_id) not between 1 and 200
    or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'invalid callback replacement identity' using errcode = '22023';
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id
    and callback.user_id = p_user_id
    and callback.organization_id = p_organization_id
    and callback.operation_id = v_operation_id;

  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  perform 1
  from public.antonia_quota_operations operation
  where operation.organization_id = p_organization_id
    and operation.user_id = p_user_id
    and operation.resource = v_callback.quota_resource
    and operation.operation_id = v_operation_id
    and operation.status = 'claimed'
    and operation.claim_token = p_claim_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'quota_claim_not_owned');
  end if;

  select * into v_callback
  from public.apollo_enrichment_callbacks callback
  where callback.id = p_callback_id
    and callback.user_id = p_user_id
    and callback.organization_id = p_organization_id
    and callback.operation_id = v_operation_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_callback');
  end if;
  if v_callback.status not in ('pending', 'terminal')
    or v_callback.provider_queued_at is not null
    or v_callback.provider_request_id is not null
    or v_callback.delivery_count <> 0 then
    return jsonb_build_object('outcome', 'provider_outcome_unknown');
  end if;

  update public.apollo_enrichment_callbacks callback
  set token_hash = v_token_hash,
      expires_at = p_expires_at,
      status = 'pending',
      terminal_state = null,
      terminal_at = null,
      processed_at = null,
      updated_at = now(),
      last_error_code = null,
      reconciliation_claimed_at = null,
      reconciliation_not_before = null,
      reconciliation_last_error_code = null
  where callback.id = v_callback.id;

  return jsonb_build_object('outcome', 'replaced', 'callbackId', v_callback.id);
end;
$$;

revoke all on function public.replace_unsubmitted_apollo_callback_v1(uuid, uuid, uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_unsubmitted_apollo_callback_v1(uuid, uuid, uuid, text, uuid, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
