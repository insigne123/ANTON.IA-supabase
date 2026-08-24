-- A native claim can be rejected by the privacy guard before it receives a
-- claim token. Settle the already-queued job under the same privacy lock.

create or replace function public.settle_suppressed_native_lead_research_job_v1(
  p_job_id uuid,
  p_scope_key text,
  p_organization_id uuid,
  p_user_id uuid,
  p_email text
)
returns boolean
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
  if p_job_id is null
    or p_user_id is null
    or nullif(trim(coalesce(p_scope_key, '')), '') is null
    or v_email = '' then
    raise exception 'invalid suppressed native research settlement input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
  if not exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(ue.email)) = v_email
      and (
        (ue.user_id is null and ue.organization_id is null)
        or ue.user_id = p_user_id
        or ue.organization_id = p_organization_id
      )
  ) then
    return false;
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
      attempt_count = greatest(coalesce(attempt_count, 0), 1),
      started_at = coalesce(started_at, now()),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id
    and user_id = p_user_id
    and provider = 'native-research-v1'
    and lower(trim(coalesce(email, ''))) = v_email
    and status in ('queued', 'running', 'completed', 'partial', 'insufficient_data')
    and request_claim_state in ('pre_provider', 'retryable', 'provider_submitting', 'terminal_pending');

  return found;
end;
$$;

revoke all on function public.settle_suppressed_native_lead_research_job_v1(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_suppressed_native_lead_research_job_v1(uuid, text, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
