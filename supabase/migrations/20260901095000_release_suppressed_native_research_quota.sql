-- Suppression can race the second privacy check after quota consumption. When
-- Apollo/native research has not crossed its provider boundary, reverse that
-- exact quota unit while settling the owned claim in the same transaction.
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
declare
  v_job public.lead_research_jobs%rowtype;
  v_email text;
  v_reversed_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select lower(trim(coalesce(job.email, ''))) into v_email
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id is not distinct from p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
    and job.request_claim_token = p_claim_token;
  if not found then
    return false;
  end if;

  if v_email = '' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  select * into v_job
  from public.lead_research_jobs job
  where job.id = p_job_id
    and job.scope_key = p_scope_key
    and job.organization_id is not distinct from p_organization_id
    and job.user_id = p_user_id
    and job.request_claim_state in ('pre_provider', 'provider_submitting', 'terminal_pending')
    and job.request_claim_token = p_claim_token
    and lower(trim(coalesce(job.email, ''))) = v_email
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and (
        (ue.user_id is null and ue.organization_id is null)
        or ue.user_id = p_user_id
        or ue.organization_id = p_organization_id
      )
  ) then
    return false;
  end if;

  if v_job.request_claim_state = 'pre_provider' and v_job.quota_consumed_at is not null then
    if v_job.quota_scope = 'user' then
      update public.antonia_user_daily_usage
      set usage_count = usage_count - 1, updated_at = now()
      where organization_id = p_organization_id
        and user_id = p_user_id
        and date = v_job.quota_day
        and resource = 'investigate'
        and usage_count > 0;
      get diagnostics v_reversed_count = row_count;
      if v_reversed_count <> 1 then
        raise exception 'user quota bucket is missing for suppressed research release' using errcode = '55000';
      end if;
    else
      update public.antonia_daily_usage
      set leads_investigated = leads_investigated - 1, updated_at = now()
      where organization_id = p_organization_id
        and date = v_job.quota_day
        and leads_investigated > 0;
      get diagnostics v_reversed_count = row_count;
      if v_reversed_count <> 1 then
        raise exception 'organization quota bucket is missing for suppressed research release' using errcode = '55000';
      end if;
    end if;
  end if;

  update public.lead_research_jobs
  set request_claim_state = 'provider_failed',
      request_claim_token = null,
      request_claimed_at = null,
      quota_consumed_at = case when v_job.request_claim_state = 'pre_provider' then null else quota_consumed_at end,
      quota_day = case when v_job.request_claim_state = 'pre_provider' then null else quota_day end,
      quota_scope = case when v_job.request_claim_state = 'pre_provider' then null else quota_scope end,
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
  where id = v_job.id;

  return true;
end;
$$;

revoke all on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
