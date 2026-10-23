-- Cowork sub-agents (the harness's «delegar»): the coordinator hands a research to a Investigadora, a Claude with its own web and its own
-- conversation, and several go at the same time. Each of their calls to the model is a new role in the ledger, «delegate», that runs inside
-- the turn under the run's lease like the coordinator, with its own room:
--   per turn: up to 12 calls and 40 000 reserved output tokens among all the delegates (2 500 reserved per call), apart from the 11 calls
--   and 55 000 tokens the other roles share, which count as before (the delegates are not in that count and do not use it up);
--   per conversation (200 calls, 1 000 000 tokens) and per person and day (300 calls, 1 800 000 tokens): delegates count like any other call.
-- The function is the one of 20261001220000_cowork_thread_root.sql with the role added (no other rule changes), and the usage of a delegate
-- call is recorded under the lease of the run like the coordinator's: the installed cowork_record_model_usage is transformed instead of copied
-- (as 20261007120000_cowork_task_plan_effect.sql does with cowork_propose_effect), so what earlier migrations changed in it stays as it is.
-- Forward-only and inert on its own: nothing reserves this role until the app ships its half, behind COWORK_SUBAGENTS_ENABLED (off by default).

alter table public.cowork_model_calls drop constraint cowork_model_calls_role_check;
alter table public.cowork_model_calls add constraint cowork_model_calls_role_check
  check (role in ('coordinator', 'writer', 'reviewer', 'judge', 'delegate', 'analyst', 'researcher', 'verifier'));

create or replace function public.cowork_reserve_model_call(p_run_id uuid, p_token uuid, p_role text, p_task_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.cowork_runs;
  root_id uuid;
  calls integer;
  tokens bigint;
  role_calls integer;
  requested integer;
  day_start timestamptz;
  admitted uuid;
begin
  select * into r from public.cowork_runs where id = p_run_id;
  if not found or p_token is null then raise exception 'Model run unavailable'; end if;
  root_id := coalesce(r.root_run_id, r.id);
  -- Every turn of a conversation takes the same lock before reading the aggregate, so two turns cannot spend the same remainder.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(root_id::text, 41004));
  select * into r from public.cowork_runs where id = p_run_id for update;
  if not found then raise exception 'Model run unavailable'; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id = g.user_id
    join public.organization_members m on m.user_id = u.id where g.user_id = r.user_id and g.enabled
    and public.cowork_open_access(u.email) and u.email_confirmed_at is not null
    and m.organization_id = r.organization_id) then raise exception 'Model access revoked'; end if;
  if p_role in ('coordinator', 'writer', 'reviewer', 'judge', 'delegate') then
    -- In-turn roles: only the worker holding the run's live lease.
    if r.status <> 'running' or r.lease_token is distinct from p_token or r.lease_expires_at <= clock_timestamp() or r.lease_expires_at is null
      then raise exception 'Model attempt expired'; end if;
    requested := case when p_role in ('coordinator', 'writer') then 6000 when p_role = 'delegate' then 2500 else 1500 end;
  else
    if p_role is null or p_role not in ('analyst', 'researcher', 'verifier') or r.status <> 'waiting_workers' or not exists(
      select 1 from public.cowork_specialist_tasks where id = p_task_id and run_id = r.id and role = p_role
        and status = 'executing' and lease_token = p_token and lease_expires_at > clock_timestamp())
      then raise exception 'Specialist attempt unavailable'; end if;
    requested := 1800;
  end if;
  -- Per turn. The sub-agents (delegate) have their own room, so a research that fans out neither takes the coordinator's calls nor is
  -- stopped by them: up to 12 calls and 40 000 reserved tokens among all of them. The rest of the roles count as they always did.
  select count(*) filter (where role <> 'delegate'), coalesce(sum(output_reserved) filter (where role <> 'delegate'), 0), count(*) filter (where role = p_role)
    into calls, tokens, role_calls from public.cowork_model_calls where run_id = r.id;
  if p_role = 'delegate' then
    select coalesce(sum(output_reserved), 0) into tokens from public.cowork_model_calls where run_id = r.id and role = 'delegate';
    if role_calls >= 12 or tokens + requested > 40000 then raise exception 'Model budget exhausted'; end if;
  elsif calls >= 11 or tokens + requested > 55000
    or role_calls >= (case p_role when 'coordinator' then 5 when 'writer' then 2 else 1 end)
    then raise exception 'Model budget exhausted'; end if;
  -- Per conversation.
  select count(*), coalesce(sum(c.output_reserved), 0) into calls, tokens
    from public.cowork_model_calls c join public.cowork_runs t on t.id = c.run_id
    where t.root_run_id = root_id and t.user_id = r.user_id and t.organization_id = r.organization_id;
  if calls >= 200 or tokens + requested > 1000000 then raise exception 'Conversation model budget exhausted'; end if;
  -- Per person and day, in Santiago time. Under the same lock per person, so parallel conversations share the remainder.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text, 41005));
  day_start := (date_trunc('day', clock_timestamp() at time zone 'America/Santiago')) at time zone 'America/Santiago';
  select count(*), coalesce(sum(output_reserved), 0) into calls, tokens
    from public.cowork_model_calls where user_id = r.user_id and created_at >= day_start;
  if calls >= 300 or tokens + requested > 1800000 then raise exception 'Daily model budget exhausted'; end if;
  insert into public.cowork_model_calls(run_id, user_id, organization_id, role, output_reserved)
    values (r.id, r.user_id, r.organization_id, p_role, requested) returning id into admitted;
  return admitted;
end; $$;

do $$
declare target regprocedure := to_regprocedure('public.cowork_record_model_usage(uuid,uuid,jsonb)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_record_model_usage is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '(''coordinator'',''writer'',''reviewer'',''judge'')', '(''coordinator'',''writer'',''reviewer'',''judge'',''delegate'')');
  if changed = definition then raise exception 'The in-turn roles of cowork_record_model_usage were not found'; end if;
  execute changed;
end $$;
