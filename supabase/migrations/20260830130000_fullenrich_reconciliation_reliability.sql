-- Keep the v1 RPCs available for an app deployment already in flight. The v2
-- claim returns its durable attempt count, and v2 release clears an exact
-- claim after the callback has become terminal as well as while it is active.
create function public.claim_fullenrich_enrichment_reconciliation_candidates_v2(
  p_limit integer,
  p_stale_before timestamptz,
  p_cooldown_before timestamptz,
  p_claim_before timestamptz
)
returns table (
  callback_id uuid,
  provider_enrichment_id text,
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
    select callback.callback_id
    from public.fullenrich_enrichment_callbacks callback
    where callback.status in ('pending', 'processing')
      and callback.provider_enrichment_id is not null
      and callback.created_at <= p_stale_before
      and (
        callback.last_reconciliation_at is null
        or callback.last_reconciliation_at <= p_cooldown_before
      )
      and (
        callback.reconciliation_claimed_at is null
        or callback.reconciliation_claimed_at <= p_claim_before
      )
    order by callback.last_reconciliation_at asc nulls first, callback.created_at asc
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.fullenrich_enrichment_callbacks callback
    set reconciliation_attempt_count = callback.reconciliation_attempt_count + 1,
        last_reconciliation_at = v_now,
        reconciliation_claimed_at = v_now,
        reconciliation_last_error_code = null,
        updated_at = v_now
    from candidates
    where callback.callback_id = candidates.callback_id
    returning
      callback.callback_id,
      callback.provider_enrichment_id,
      callback.reconciliation_claimed_at,
      callback.reconciliation_attempt_count
  )
  select
    claimed.callback_id,
    claimed.provider_enrichment_id,
    claimed.reconciliation_claimed_at,
    claimed.reconciliation_attempt_count
  from claimed;
end;
$$;

create function public.release_fullenrich_enrichment_reconciliation_candidates_v2(
  p_callback_ids uuid[],
  p_claimed_at timestamptz,
  p_error_code text default null
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
    or p_claimed_at is null then
    raise exception 'invalid reconciliation release input' using errcode = '22023';
  end if;
  if v_error_code is not null and char_length(v_error_code) > 100 then
    raise exception 'invalid reconciliation error code' using errcode = '22023';
  end if;

  select array_agg(distinct ids.callback_id)
  into v_callback_ids
  from unnest(p_callback_ids) as ids(callback_id);

  update public.fullenrich_enrichment_callbacks callback
  set reconciliation_claimed_at = null,
      reconciliation_last_error_code = v_error_code,
      updated_at = now()
  where callback.callback_id = any(v_callback_ids)
    and callback.reconciliation_claimed_at = p_claimed_at;
  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

revoke all on function public.claim_fullenrich_enrichment_reconciliation_candidates_v2(integer, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_fullenrich_enrichment_reconciliation_candidates_v2(integer, timestamptz, timestamptz, timestamptz)
  to service_role;

revoke all on function public.release_fullenrich_enrichment_reconciliation_candidates_v2(uuid[], timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.release_fullenrich_enrichment_reconciliation_candidates_v2(uuid[], timestamptz, text)
  to service_role;

notify pgrst, 'reload schema';
