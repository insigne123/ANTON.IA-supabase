-- Cowork scheduled tasks: a request the person wants answered again and again («cada lunes a las 9, dime quién respondió y a quién
-- escribir hoy»). Each firing starts a new Cowork conversation in approval mode with the request as its first message, so what needs a
-- decision waits there as a proposal; the worker that already runs every minute claims the tasks that are due (src/lib/server/cowork/
-- schedules.ts). One row per task. The owner reads their own rows with their session, while they have Cowork access; only the server
-- writes, with the service role, after checking the request (the cadence, the limits and who the task belongs to).
-- «status» is proposed (Cowork suggested it and the person has not approved it), active or paused; only an active task has a next
-- firing. At most 5 active tasks and 20 in all per person: the server checks it and the trigger below is the backstop.
-- Forward-only and inert on its own: nothing reads or writes it until the app ships its half, behind COWORK_SCHEDULES_ENABLED
-- (off by default). The kind «schedule_create» joins the vocabulary of effects for the proposals Cowork will make from a chat.
create table public.cowork_scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Trimmed, as the app stores them.
  title text not null check (title = btrim(title) and char_length(title) between 3 and 80),
  prompt text not null check (prompt = btrim(prompt) and char_length(prompt) between 10 and 2000),
  frequency text not null check (frequency in ('daily', 'weekdays', 'weekly', 'monthly')),
  -- Local time of the task, «HH:MM» in 24 hours, in time_zone.
  time_of_day text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- ISO weekday (1 Monday … 7 Sunday) for weekly tasks; day of the month (up to 28, so every month has it) for monthly ones.
  weekday smallint check (weekday between 1 and 7),
  month_day smallint check (month_day between 1 and 28),
  time_zone text not null default 'America/Santiago' check (char_length(time_zone) between 3 and 64),
  status text not null default 'active' check (status in ('proposed', 'active', 'paused')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_id uuid,
  last_status text check (last_status in ('admitted', 'skipped', 'failed')),
  consecutive_failures smallint not null default 0 check (consecutive_failures >= 0),
  run_count integer not null default 0 check (run_count >= 0),
  -- The conversation where the person approved it, when Cowork proposed it.
  created_from_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((frequency = 'weekly') = (weekday is not null)),
  check ((frequency = 'monthly') = (month_day is not null)),
  check ((status = 'active') = (next_run_at is not null))
);
create index cowork_scheduled_tasks_scope on public.cowork_scheduled_tasks(user_id, organization_id, created_at);
-- The worker asks for the tasks that are due every minute.
create index cowork_scheduled_tasks_due on public.cowork_scheduled_tasks(next_run_at) where status = 'active';
alter table public.cowork_scheduled_tasks enable row level security;
revoke all on public.cowork_scheduled_tasks from public, anon, authenticated;
grant select on public.cowork_scheduled_tasks to authenticated;
grant all on public.cowork_scheduled_tasks to service_role;
create policy cowork_scheduled_tasks_private_read on public.cowork_scheduled_tasks for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

create function public.cowork_scheduled_tasks_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  -- One person's tasks are counted one writer at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cowork_scheduled_tasks:' || new.user_id::text, 0));
  if tg_op = 'INSERT' then
    if (select count(*) from public.cowork_scheduled_tasks t where t.user_id = new.user_id) >= 20 then
      raise exception 'Too many scheduled tasks' using errcode = '23514';
    end if;
    if new.status = 'active' and (select count(*) from public.cowork_scheduled_tasks t where t.user_id = new.user_id and t.status = 'active') >= 5 then
      raise exception 'Too many active scheduled tasks' using errcode = '23514';
    end if;
  elsif new.status = 'active' and old.status is distinct from 'active'
    and (select count(*) from public.cowork_scheduled_tasks t where t.user_id = new.user_id and t.status = 'active' and t.id <> new.id) >= 5 then
    raise exception 'Too many active scheduled tasks' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.cowork_scheduled_tasks_guard() from public, anon, authenticated;
create trigger cowork_scheduled_tasks_guard before insert or update on public.cowork_scheduled_tasks
  for each row execute function public.cowork_scheduled_tasks_guard();

-- The new kind of effect, in the two places that know the vocabulary: the check of the proposals table and the list inside
-- cowork_propose_effect. Its installed definition is transformed instead of copied (as 20261007120000_cowork_task_plan_effect.sql
-- does), so everything earlier migrations added stays exactly as it is. «create or replace» keeps the owner and privileges.
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch',
    'campaign_retry', 'enrich_phone', 'lead_prepare_batch', 'memory_save', 'task_plan', 'schedule_create'));

do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''task_plan'') then', '''task_plan'',''schedule_create'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
