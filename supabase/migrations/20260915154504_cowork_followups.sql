-- Version aligned with production migration ledger.
alter table public.cowork_runs add column parent_run_id uuid;
alter table public.cowork_runs add constraint cowork_parent_scope_fk
  foreign key (parent_run_id, user_id, organization_id)
  references public.cowork_runs(id, user_id, organization_id);

create function public.cowork_admit_followup(
  p_user_id uuid, p_organization_id uuid, p_request_id uuid,
  p_message text, p_mode text, p_parent_run_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; existing_id uuid; existing_parent uuid;
begin
  -- Serialize retry admissions for this idempotency key, including parent identity.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || p_organization_id::text || p_request_id::text, 0));
  if p_parent_run_id is not null then
    perform 1 from public.cowork_runs where id = p_parent_run_id
      and user_id = p_user_id and organization_id = p_organization_id and status = 'completed';
    if not found then raise exception 'Parent unavailable' using errcode = '22023'; end if;
  end if;
  select id, parent_run_id into existing_id, existing_parent from public.cowork_runs
    where user_id = p_user_id and organization_id = p_organization_id and request_id = p_request_id;
  if existing_id is not null and existing_parent is distinct from p_parent_run_id then
    raise exception 'Idempotency conflict' using errcode = '22023';
  end if;
  result_id := public.cowork_admit_run(p_user_id, p_organization_id, p_request_id, p_message, p_mode);
  if existing_id is null then
    update public.cowork_runs set parent_run_id = p_parent_run_id where id = result_id;
  end if;
  return result_id;
end;
$$;
revoke all on function public.cowork_admit_followup(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.cowork_admit_followup(uuid, uuid, uuid, text, text, uuid) to service_role;
