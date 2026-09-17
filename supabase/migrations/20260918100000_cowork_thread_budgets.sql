-- Fase 1 (CW-06): presupuestos por hilo de continuaciones automaticas.
-- depth cuenta solo pasos admitidos por el worker; los followups del usuario
-- reinician la cadena (p_reset_depth) para no limitar la conversacion humana.
-- El techo absoluto 10 es respaldo en base de datos; la politica vigente
-- (src/lib/cowork/thread-budget.ts) aplica topes menores en codigo.
alter table public.cowork_runs add column if not exists depth integer not null default 0;

create or replace function public.cowork_admit_followup(
  p_user_id uuid, p_organization_id uuid, p_request_id uuid,
  p_message text, p_mode text, p_parent_run_id uuid,
  p_reset_depth boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; existing_id uuid; existing_parent uuid; parent_depth integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || p_organization_id::text || p_request_id::text, 0));
  parent_depth := -1;
  if p_parent_run_id is not null then
    select r.depth into parent_depth from public.cowork_runs r where r.id = p_parent_run_id
      and r.user_id = p_user_id and r.organization_id = p_organization_id and r.status = 'completed';
    if not found then raise exception 'Parent unavailable' using errcode = '22023'; end if;
  end if;
  if not p_reset_depth and parent_depth >= 10 then
    raise exception 'Thread budget exhausted' using errcode = '22023';
  end if;
  select id, parent_run_id into existing_id, existing_parent from public.cowork_runs
    where user_id = p_user_id and organization_id = p_organization_id and request_id = p_request_id;
  if existing_id is not null and existing_parent is distinct from p_parent_run_id then
    raise exception 'Idempotency conflict' using errcode = '22023';
  end if;
  result_id := public.cowork_admit_run(p_user_id, p_organization_id, p_request_id, p_message, p_mode);
  if existing_id is null then
    update public.cowork_runs
      set parent_run_id = p_parent_run_id,
        depth = case when p_reset_depth or p_parent_run_id is null then 0 else parent_depth + 1 end
      where id = result_id;
  end if;
  return result_id;
end;
$$;
revoke all on function public.cowork_admit_followup(uuid, uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.cowork_admit_followup(uuid, uuid, uuid, text, text, uuid, boolean) to service_role;
