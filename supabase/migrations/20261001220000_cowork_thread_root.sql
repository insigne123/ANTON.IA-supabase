-- Long conversations (docs/cowork-conversaciones-largas.md). In the test of 1 Oct a conversation stopped with «Este hilo
-- alcanzó su límite» after 13 steps: cowork_reserve_model_call walked the ancestry run by run and refused past 13 ancestors,
-- although the conversation had used only 22 of its 40 calls. Now every run knows the first run of its conversation
-- (root_run_id), kept by a trigger when it is created or attached to its parent, so the budget reads the conversation directly
-- at any length. The caps change with it:
--   per turn: as before (11 calls, 55 000 reserved tokens, and the calls per role);
--   per conversation: 200 calls and 1 000 000 reserved tokens (was 40 and 180 000), a guard against a loop rather than a limit
--     people meet, now that the conversation keeps a memory of its own;
--   per person per day (Santiago time): 300 calls and 1 800 000 reserved tokens, to look after the cost. The busiest day so far
--     used 55 calls and 330 000.
-- Forward-only. The reservation is replaced whole («create or replace» keeps its owner and privileges); everything else of it
-- (lease, roles, access grant, the lock per conversation) stays as it was.

alter table public.cowork_runs add column root_run_id uuid;

with recursive chain as (
  select id, id as root_id from public.cowork_runs where parent_run_id is null
  union all
  select child.id, chain.root_id from public.cowork_runs child join chain on child.parent_run_id = chain.id
)
update public.cowork_runs r set root_run_id = chain.root_id from chain where r.id = chain.id;
-- A run whose ancestry could not be followed is its own conversation.
update public.cowork_runs set root_run_id = id where root_run_id is null;

create function public.cowork_runs_root_v1() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.parent_run_id is null then
    new.root_run_id := new.id;
  else
    -- The parent is in the same account (cowork_parent_scope_fk); its conversation is this run's conversation.
    select coalesce(p.root_run_id, p.id) into new.root_run_id from public.cowork_runs p
      where p.id = new.parent_run_id and p.user_id = new.user_id and p.organization_id = new.organization_id;
    if new.root_run_id is null then new.root_run_id := new.id; end if;
  end if;
  return new;
end $$;
revoke all on function public.cowork_runs_root_v1() from public, anon, authenticated;
create trigger cowork_runs_root before insert or update of parent_run_id on public.cowork_runs
  for each row execute function public.cowork_runs_root_v1();

alter table public.cowork_runs alter column root_run_id set not null;
create index cowork_runs_root_idx on public.cowork_runs (root_run_id);
create index cowork_model_calls_user_day_idx on public.cowork_model_calls (user_id, created_at);

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
  if p_role in ('coordinator', 'writer', 'reviewer', 'judge') then
    -- In-turn roles: only the worker holding the run's live lease.
    if r.status <> 'running' or r.lease_token is distinct from p_token or r.lease_expires_at <= clock_timestamp() or r.lease_expires_at is null
      then raise exception 'Model attempt expired'; end if;
    requested := case when p_role in ('coordinator', 'writer') then 6000 else 1500 end;
  else
    if p_role is null or p_role not in ('analyst', 'researcher', 'verifier') or r.status <> 'waiting_workers' or not exists(
      select 1 from public.cowork_specialist_tasks where id = p_task_id and run_id = r.id and role = p_role
        and status = 'executing' and lease_token = p_token and lease_expires_at > clock_timestamp())
      then raise exception 'Specialist attempt unavailable'; end if;
    requested := 1800;
  end if;
  -- Per turn.
  select count(*), coalesce(sum(output_reserved), 0), count(*) filter (where role = p_role)
    into calls, tokens, role_calls from public.cowork_model_calls where run_id = r.id;
  if calls >= 11 or tokens + requested > 55000
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
