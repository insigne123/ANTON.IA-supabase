-- Keep native research runs and jobs consistent when queue workers overlap.

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
    or v_provider_status not in ('completed', 'partial', 'insufficient_data') then
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

create or replace function public.abort_native_lead_research_request_claim_v1(
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
  set request_claim_state = 'provider_failed',
      request_claim_token = null,
      request_claimed_at = null,
      status = 'cancelled',
      error_code = coalesce(nullif(trim(coalesce(p_error_code, '')), ''), 'native_research_run_setup_failed'),
      error_message = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), 'The native research run could not be initialized safely.'),
      result_payload = jsonb_build_object('provider_status', 'cancelled'),
      started_at = coalesce(started_at, now()),
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and scope_key = p_scope_key
    and organization_id is not distinct from p_organization_id
    and user_id = p_user_id
    and request_claim_state = 'pre_provider'
    and request_claim_token = p_claim_token;

  return found;
end;
$$;

create or replace function public.settle_native_research_run_items_v1(
  p_job_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_run_id uuid;
  v_total integer;
  v_completed integer;
  v_failed integer;
  v_done integer;
  v_active boolean;
  v_updated integer := 0;
  v_runs integer := 0;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_job_id is null or p_organization_id is null or p_user_id is null
    or v_status not in ('queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled') then
    raise exception 'invalid native research run settlement input' using errcode = '22023';
  end if;

  update public.research_run_items
  set status = v_status,
      error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      updated_at = now()
  where job_id = p_job_id
    and organization_id = p_organization_id
    and user_id = p_user_id;
  get diagnostics v_updated = row_count;

  for v_run_id in
    select distinct rri.run_id
    from public.research_run_items rri
    where rri.job_id = p_job_id
      and rri.organization_id = p_organization_id
      and rri.user_id = p_user_id
    order by rri.run_id
  loop
    perform 1
    from public.research_runs rr
    where rr.id = v_run_id
      and rr.organization_id = p_organization_id
      and rr.user_id = p_user_id
    for update;
    if not found then
      continue;
    end if;

    select
      count(*)::integer,
      (count(*) filter (where rri.status in ('completed', 'partial')))::integer,
      (count(*) filter (where rri.status in ('insufficient_data', 'failed', 'cancelled')))::integer,
      bool_or(rri.status = 'running')
    into v_total, v_completed, v_failed, v_active
    from public.research_run_items rri
    where rri.run_id = v_run_id
      and rri.organization_id = p_organization_id
      and rri.user_id = p_user_id;

    v_done := v_completed + v_failed;
    update public.research_runs
    set status = case
          when v_done < v_total and coalesce(v_active, false) then 'running'
          when v_done < v_total then 'queued'
          when v_failed = 0 then 'completed'
          when v_completed > 0 then 'partial'
          else 'failed'
        end,
        completed_count = v_completed,
        failed_count = v_failed,
        started_at = case
          when v_done > 0 or coalesce(v_active, false) then coalesce(started_at, now())
          else started_at
        end,
        completed_at = case when v_total > 0 and v_done >= v_total then now() else null end,
        updated_at = now()
    where id = v_run_id
      and organization_id = p_organization_id
      and user_id = p_user_id;
    v_runs := v_runs + 1;
  end loop;

  return jsonb_build_object('updated', v_updated, 'runs', v_runs);
end;
$$;

create unique index if not exists research_runs_active_request_uidx
  on public.research_runs (organization_id, user_id, (request_payload ->> 'request_key'))
  where status in ('queued', 'running') and request_payload ? 'request_key';

revoke all on function public.abort_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.settle_native_research_run_items_v1(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.abort_native_lead_research_request_claim_v1(uuid, text, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.settle_native_research_run_items_v1(uuid, uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
