-- Move attributable canonical events, then rebuild the affected daily range
-- from the ledger instead of rewriting derived rollups.
set local lock_timeout = '10s';
set local statement_timeout = '2min';

lock table public.antonia_event_ledger, public.antonia_event_rollups_daily
  in share row exclusive mode;

create temporary table grupoexpro_event_users (user_id uuid primary key) on commit drop;
insert into grupoexpro_event_users (user_id)
select id from auth.users
where lower(btrim(email)) ~ '^[^@[:space:]]+@grupoexpro[.]com$';

create temporary table grupoexpro_event_context (organization_id uuid primary key) on commit drop;
insert into grupoexpro_event_context (organization_id)
select id from public.organizations where lower(btrim(name)) = 'grupoexpro';

do $$
declare
  v_event_count bigint;
  v_rollup_count bigint;
  v_from date;
  v_to date;
begin
  if (select count(*) from grupoexpro_event_users) <> 6
    or (select count(*) from grupoexpro_event_context) <> 1 then
    raise exception 'GrupoExpro event identity preflight failed';
  end if;

  select count(*), min((occurred_at at time zone 'UTC')::date),
    max((occurred_at at time zone 'UTC')::date)
  into v_event_count, v_from, v_to
  from public.antonia_event_ledger
  where actor_user_id in (select user_id from grupoexpro_event_users)
     or initiated_by_user_id in (select user_id from grupoexpro_event_users);

  select count(*) into v_rollup_count
  from public.antonia_event_rollups_daily
  where actor_user_id in (select user_id from grupoexpro_event_users);

  if v_event_count <> 941 or v_rollup_count <> 93 then
    raise exception 'Unexpected GrupoExpro event snapshot: events %, rollups %',
      v_event_count, v_rollup_count;
  end if;
  if v_from is null or v_to is null or v_to - v_from > 366 then
    raise exception 'GrupoExpro event range is not bounded';
  end if;
end;
$$;

select set_config('app.antonia_event_ledger_redaction', 'on', true);

update public.antonia_event_ledger event
set organization_id = context.organization_id,
    organization_ref = context.organization_id::text
from grupoexpro_event_context context
where (
    event.actor_user_id in (select user_id from grupoexpro_event_users)
    or event.initiated_by_user_id in (select user_id from grupoexpro_event_users)
  )
  and (
    event.organization_id is distinct from context.organization_id
    or event.organization_ref is distinct from context.organization_id::text
  );

select set_config('app.antonia_event_ledger_redaction', 'off', true);

select public.refresh_antonia_event_rollups_daily_v1(
  min((event.occurred_at at time zone 'UTC')::date),
  max((event.occurred_at at time zone 'UTC')::date)
)
from public.antonia_event_ledger event
where event.actor_user_id in (select user_id from grupoexpro_event_users)
   or event.initiated_by_user_id in (select user_id from grupoexpro_event_users);

do $$
declare
  v_context uuid := (select organization_id from grupoexpro_event_context);
begin
  if (
    select count(*) from public.antonia_event_ledger
    where actor_user_id in (select user_id from grupoexpro_event_users)
       or initiated_by_user_id in (select user_id from grupoexpro_event_users)
  ) <> 941 then
    raise exception 'GrupoExpro event count changed during consolidation';
  end if;

  if exists (
    select 1 from public.antonia_event_ledger event
    where (
        event.actor_user_id in (select user_id from grupoexpro_event_users)
        or event.initiated_by_user_id in (select user_id from grupoexpro_event_users)
      )
      and (
        event.organization_id is distinct from v_context
        or event.organization_ref is distinct from v_context::text
      )
  ) then
    raise exception 'GrupoExpro canonical event scope validation failed';
  end if;

  if exists (
    select 1 from public.antonia_event_rollups_daily rollup
    where rollup.actor_user_id in (select user_id from grupoexpro_event_users)
      and rollup.organization_id is distinct from v_context
  ) then
    raise exception 'GrupoExpro event rollup scope validation failed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
