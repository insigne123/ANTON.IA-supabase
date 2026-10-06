-- Seven SECURITY DEFINER functions of ANTON.IA that anyone could call through /rest/v1/rpc without a session
-- (docs/seguridad-avisos-supabase-2026-10.md). The app never calls them: the worker does, as service_role, and pg_cron runs
-- as postgres. Earlier migrations revoked them from public, but Supabase's default privileges grant EXECUTE to anon and
-- authenticated separately, so those grants stayed. Two of them (trigger_antonia_*) were created outside this repository,
-- so each function is changed only if it exists.
do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.claim_antonia_tasks(integer, text, text)',
    'public.schedule_daily_mission_tasks()',
    'public.increment_daily_usage(uuid, date, integer, integer, integer, integer)',
    'public.claim_suplia_tool_lease(uuid, text, integer, integer, uuid, uuid, uuid, jsonb)',
    'public.release_suplia_tool_lease(text)',
    'public.trigger_antonia_worker()',
    'public.trigger_antonia_daily_execution()'
  ] loop
    if to_regprocedure(v_function) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', v_function);
      execute format('grant execute on function %s to service_role', v_function);
    end if;
  end loop;
end $$;
