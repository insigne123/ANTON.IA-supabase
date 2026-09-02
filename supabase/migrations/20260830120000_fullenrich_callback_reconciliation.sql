-- Callback deliveries are normally sufficient. These fields and RPCs support a
-- narrow recovery poll for batches whose provider callback was not delivered.
alter table public.fullenrich_enrichment_callbacks
  add column if not exists reconciliation_attempt_count integer not null default 0
    check (reconciliation_attempt_count >= 0),
  add column if not exists last_reconciliation_at timestamptz,
  add column if not exists reconciliation_claimed_at timestamptz,
  add column if not exists reconciliation_last_error_code text
    check (
      reconciliation_last_error_code is null
      or char_length(trim(reconciliation_last_error_code)) between 1 and 100
    );

create index if not exists fullenrich_enrichment_callbacks_reconciliation_idx
  on public.fullenrich_enrichment_callbacks (last_reconciliation_at asc nulls first, created_at, provider_enrichment_id)
  where status in ('pending', 'processing')
    and provider_enrichment_id is not null;

-- Claims are short-lived and skip locked rows so overlapping scheduler runs do
-- not poll or settle the same provider batch concurrently.
create or replace function public.claim_fullenrich_enrichment_reconciliation_candidates_v1(
  p_limit integer,
  p_stale_before timestamptz,
  p_cooldown_before timestamptz,
  p_claim_before timestamptz
)
returns table (
  callback_id uuid,
  provider_enrichment_id text,
  reconciliation_claimed_at timestamptz
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
    -- Retry the least-recently reconciled rows first. Otherwise a permanent
    -- provider 404 at the front of the queue can starve newer lost callbacks.
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
    returning callback.callback_id, callback.provider_enrichment_id, callback.reconciliation_claimed_at
  )
  select claimed.callback_id, claimed.provider_enrichment_id, claimed.reconciliation_claimed_at
  from claimed;
end;
$$;

-- Releasing only an exact claim timestamp prevents an older worker from
-- clearing a claim acquired by a subsequent recovery attempt.
create or replace function public.release_fullenrich_enrichment_reconciliation_candidates_v1(
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
    and callback.reconciliation_claimed_at = p_claimed_at
    and callback.status in ('pending', 'processing');
  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

revoke all on function public.claim_fullenrich_enrichment_reconciliation_candidates_v1(integer, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_fullenrich_enrichment_reconciliation_candidates_v1(integer, timestamptz, timestamptz, timestamptz)
  to service_role;
revoke all on function public.release_fullenrich_enrichment_reconciliation_candidates_v1(uuid[], timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.release_fullenrich_enrichment_reconciliation_candidates_v1(uuid[], timestamptz, text)
  to service_role;

notify pgrst, 'reload schema';
