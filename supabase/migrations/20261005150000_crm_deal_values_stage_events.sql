-- Plan 11 (PR 4b): the pipeline as a CRM. Two things a CRM panel needs and unified_crm_data lacked:
-- 1. The value of each deal (deal_value, deal_currency), for «ingreso esperado» and «ganado» by stage and by period.
-- 2. When each lead changed stage: stage_changed_at, won_at, lost_at on the row, and the whole history in
--    crm_stage_events, so the panel compares periods («3 reuniones este mes, 2 más que el anterior»).
-- The history is written by a trigger on every change of stage, from any path (the board, accepted suggestions, Cowork),
-- so nobody has to remember to log it. It is append-only: members read their organization's, only the trigger writes.
alter table public.unified_crm_data
  add column if not exists deal_value numeric(14, 2),
  add column if not exists deal_currency text not null default 'CLP',
  add column if not exists stage_changed_at timestamptz,
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'unified_crm_data_deal_value_check') then
    alter table public.unified_crm_data add constraint unified_crm_data_deal_value_check
      check (deal_value is null or (deal_value >= 0 and deal_value < 1000000000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unified_crm_data_deal_currency_check') then
    alter table public.unified_crm_data add constraint unified_crm_data_deal_currency_check
      check (deal_currency in ('CLP', 'USD', 'UF', 'EUR'));
  end if;
end $$;

create table if not exists public.crm_stage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  crm_id text not null,
  from_stage text,
  to_stage text not null,
  source text not null default 'manual',
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint crm_stage_events_crm_id_check check (length(crm_id) between 1 and 300),
  constraint crm_stage_events_stage_check check (length(to_stage) between 1 and 40 and (from_stage is null or length(from_stage) <= 40)),
  constraint crm_stage_events_source_check check (source in ('manual', 'suggestion', 'automatic', 'import'))
);

create index if not exists crm_stage_events_org_changed_idx on public.crm_stage_events (organization_id, changed_at desc);
create index if not exists crm_stage_events_org_crm_idx on public.crm_stage_events (organization_id, crm_id, changed_at desc);

alter table public.crm_stage_events enable row level security;
revoke all on table public.crm_stage_events from public, anon, authenticated;
grant select on table public.crm_stage_events to authenticated;
grant all on table public.crm_stage_events to service_role;

drop policy if exists "Organization members read their stage history" on public.crm_stage_events;
create policy "Organization members read their stage history"
  on public.crm_stage_events for select to authenticated
  using (public.is_current_user_organization_member(organization_id));

-- Two triggers, because an upsert (INSERT … ON CONFLICT DO UPDATE, as accepting a suggestion does) fires the BEFORE INSERT
-- trigger even when the row then updates: the dates are set BEFORE (harmless on a discarded row) and the history is
-- appended AFTER, which only fires for what really happened.
create or replace function public.crm_stage_dates()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.stage is null or (tg_op = 'UPDATE' and new.stage is not distinct from old.stage) then
    return new;
  end if;
  new.stage_changed_at := now();
  if new.stage = 'closed_won' then new.won_at := coalesce(new.won_at, now()); new.lost_at := null;
  elsif new.stage = 'closed_lost' then new.lost_at := coalesce(new.lost_at, now()); new.won_at := null;
  else new.won_at := null; new.lost_at := null;
  end if;
  return new;
end;
$$;

-- A caller may name the source for its transaction with set_config('app.crm_stage_source', 'suggestion' | 'automatic' |
-- 'import', true); anything else is 'manual'.
create or replace function public.crm_log_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text := coalesce(nullif(current_setting('app.crm_stage_source', true), ''), 'manual');
begin
  if new.stage is null or new.organization_id is null or (tg_op = 'UPDATE' and new.stage is not distinct from old.stage) then
    return null;
  end if;
  if v_source not in ('manual', 'suggestion', 'automatic', 'import') then
    v_source := 'manual';
  end if;
  insert into public.crm_stage_events (organization_id, crm_id, from_stage, to_stage, source, changed_by)
  values (new.organization_id, new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage, v_source, auth.uid());
  return null;
end;
$$;

revoke all on function public.crm_stage_dates() from public, anon, authenticated;
revoke all on function public.crm_log_stage_change() from public, anon, authenticated;

drop trigger if exists crm_stage_dates on public.unified_crm_data;
create trigger crm_stage_dates
  before insert or update of stage on public.unified_crm_data
  for each row execute function public.crm_stage_dates();

drop trigger if exists crm_log_stage_change on public.unified_crm_data;
create trigger crm_log_stage_change
  after insert or update of stage on public.unified_crm_data
  for each row execute function public.crm_log_stage_change();
