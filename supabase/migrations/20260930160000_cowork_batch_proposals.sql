-- Approving several people with one decision («aprobar en lote»). When the worker proposes a batch
-- of LinkedIn invitations or messages it stages here exactly what the approval card lists: one
-- entry per person (their id, who they are and, for messages, the text each one gets), the people
-- left for another day and a hash of the list. The person can take people off the card before
-- approving; the approved effect runs for everyone left, checking each one again, and reports what
-- happened person by person. The list and its hash never change after staging, and people can be
-- removed only while the proposal still awaits the decision, so an approval can neither reach
-- someone the person did not see nor someone they took out. One batch per run; it goes away with
-- its run. Like the other staging tables, only the worker (service_role) reads or writes it.
-- Forward-only and inert on its own: nothing proposes these effects until the app ships its half.
create table public.cowork_batch_proposals (
  run_id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null,
  kind text not null check (kind in ('linkedin_invite_batch', 'linkedin_message_batch')),
  -- [{"id": lead id, "name": …, "company": …, "title": …, "message": text (messages only)}], at most 50 people.
  items jsonb not null check (case when jsonb_typeof(items) = 'array'
    then jsonb_array_length(items) between 1 and 50 and length(items::text) <= 120000 else false end),
  -- The people of the same search left for another day, each with why: shown on the card, never run.
  deferred jsonb not null default '[]'::jsonb check (case when jsonb_typeof(deferred) = 'array'
    then jsonb_array_length(deferred) <= 200 and length(deferred::text) <= 60000 else false end),
  -- Ids of the people the person took off the card.
  excluded jsonb not null default '[]'::jsonb check (case when jsonb_typeof(excluded) = 'array'
    then jsonb_array_length(excluded) <= 50 else false end),
  patch_hash text not null check (patch_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (run_id, user_id, organization_id)
    references public.cowork_runs(id, user_id, organization_id) on delete cascade
);
alter table public.cowork_batch_proposals enable row level security;
revoke all on public.cowork_batch_proposals from public, anon, authenticated;
grant all on public.cowork_batch_proposals to service_role;

-- What the table cannot say with a check: who is in the batch, what each one gets and when people can
-- be removed. Not a security definer: it reads cowork_effect_proposals as the worker that writes here.
create function public.cowork_batch_proposals_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare ids text[];
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from jsonb_array_elements(new.items) as i(item)
      where jsonb_typeof(i.item) <> 'object'
        or coalesce(i.item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'Every person of a batch needs an id' using errcode = '23514';
    end if;
    select array_agg(i.item->>'id') into ids from jsonb_array_elements(new.items) as i(item);
    if (select count(distinct m.id) from unnest(ids) as m(id)) <> cardinality(ids) then
      raise exception 'A person appears once in a batch' using errcode = '23514';
    end if;
    if new.kind = 'linkedin_message_batch' then
      if exists (select 1 from jsonb_array_elements(new.items) as i(item)
        where jsonb_typeof(i.item->'message') is distinct from 'string' or length(btrim(i.item->>'message')) not between 1 and 1200) then
        raise exception 'Every message of a batch needs its text' using errcode = '23514';
      end if;
    elsif exists (select 1 from jsonb_array_elements(new.items) as i(item) where i.item->'message' is not null) then
      raise exception 'Invitations go without a note' using errcode = '23514';
    end if;
    if new.excluded <> '[]'::jsonb then
      raise exception 'A batch is staged with everyone in it' using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.run_id, new.user_id, new.organization_id, new.kind, new.items, new.deferred, new.patch_hash, new.created_at)
    is distinct from (old.run_id, old.user_id, old.organization_id, old.kind, old.items, old.deferred, old.patch_hash, old.created_at) then
    raise exception 'A staged batch cannot change; only people can be removed from it' using errcode = '23514';
  end if;
  if new.excluded is distinct from old.excluded then
    -- The proposal's row is locked while the removal is written: an approval waits for it, so the
    -- people removed are exactly the ones the approval runs without; if the approval came first, this refuses.
    perform 1 from public.cowork_effect_proposals p
      where p.run_id = new.run_id and p.kind = new.kind and p.status = 'proposed' for update;
    if not found then
      raise exception 'People can only be removed from a batch that still awaits the decision' using errcode = '23514';
    end if;
    select array_agg(i.item->>'id') into ids from jsonb_array_elements(new.items) as i(item);
    if exists (select 1 from jsonb_array_elements(new.excluded) as r(removed)
      where jsonb_typeof(r.removed) <> 'string' or not ((r.removed #>> '{}') = any(ids))) then
      raise exception 'Only people of the batch can be removed from it' using errcode = '23514';
    end if;
    if (select count(distinct r.removed #>> '{}') from jsonb_array_elements(new.excluded) as r(removed)) <> jsonb_array_length(new.excluded) then
      raise exception 'A person is removed once' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.cowork_batch_proposals_guard() from public, anon, authenticated;
create trigger cowork_batch_proposals_guard before insert or update on public.cowork_batch_proposals
  for each row execute function public.cowork_batch_proposals_guard();

-- One company a day, counting email and LinkedIn: a LinkedIn job remembers the company it was queued
-- for (a normalized key, the one email sends are counted with) so the next batch can leave out the
-- companies already touched today. Nullable: the jobs queued before this have none.
alter table public.cowork_linkedin_jobs add column company_key text
  check (company_key is null or length(company_key) between 1 and 200);
create index cowork_linkedin_jobs_company_day_idx
  on public.cowork_linkedin_jobs (organization_id, user_id, company_key, created_at desc) where company_key is not null;

alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message',
    'contacts_import', 'reply_thread', 'linkedin_invite_batch', 'linkedin_message_batch'));

-- cowork_propose_effect must accept the same vocabulary as the table constraint. Its installed
-- definition is transformed instead of copied (as 20260930150000_cowork_reply_thread.sql does): the
-- contacts import and the access policy extended it, and this keeps all of that exactly as it is.
-- The only change is the two new kinds in the list of known effects. «create or replace» keeps the
-- function's owner and privileges.
do $$
declare target regprocedure := to_regprocedure('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)');
  definition text; changed text;
begin
  if target is null then raise exception 'cowork_propose_effect is missing'; end if;
  definition := pg_get_functiondef(target);
  changed := replace(definition, '''reply_thread'') then', '''reply_thread'',''linkedin_invite_batch'',''linkedin_message_batch'') then');
  if changed = definition then raise exception 'The list of effects of cowork_propose_effect was not found'; end if;
  execute changed;
end $$;
