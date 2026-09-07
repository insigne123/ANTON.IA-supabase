-- Move the closed research and draft graph for GrupoExpro users. Composite
-- foreign keys are validated explicitly before the transaction can commit.
set local lock_timeout = '10s';
set local statement_timeout = '2min';

lock table public.research_snapshots, public.lead_research_jobs,
  public.research_runs, public.research_run_items, public.messaging_drafts,
  public.messaging_draft_versions, public.messaging_draft_generation_metadata,
  public.research_report_documents in share row exclusive mode;

create temporary table grupoexpro_research_users (user_id uuid primary key) on commit drop;
insert into grupoexpro_research_users (user_id)
select id from auth.users
where lower(btrim(email)) ~ '^[^@[:space:]]+@grupoexpro[.]com$';

create temporary table grupoexpro_research_context (organization_id uuid primary key) on commit drop;
insert into grupoexpro_research_context (organization_id)
select id from public.organizations where lower(btrim(name)) = 'grupoexpro';

do $$
declare
  v_check record;
  v_actual bigint;
begin
  if (select count(*) from grupoexpro_research_users) <> 6
    or (select count(*) from grupoexpro_research_context) <> 1 then
    raise exception 'GrupoExpro research identity preflight failed';
  end if;

  for v_check in
    select * from (values
      ('research_snapshots', 7::bigint),
      ('lead_research_jobs', 13::bigint),
      ('research_runs', 9::bigint),
      ('research_run_items', 13::bigint),
      ('messaging_drafts', 1::bigint),
      ('messaging_draft_versions', 1::bigint),
      ('messaging_draft_generation_metadata', 1::bigint),
      ('research_report_documents', 7::bigint)
    ) expected(table_name, row_count)
  loop
    execute format(
      'select count(*) from public.%I where user_id in (select user_id from grupoexpro_research_users)',
      v_check.table_name
    ) into v_actual;
    if v_actual <> v_check.row_count then
      raise exception 'Unexpected research row count for public.%: expected %, found %',
        v_check.table_name, v_check.row_count, v_actual;
    end if;
  end loop;
end;
$$;

set local session_replication_role = replica;

update public.research_snapshots target
set organization_id = context.organization_id,
    scope_key = context.organization_id::text
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and (
    target.organization_id is distinct from context.organization_id
    or target.scope_key is distinct from context.organization_id::text
  );

update public.lead_research_jobs target
set organization_id = context.organization_id,
    scope_key = context.organization_id::text
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and (
    target.organization_id is distinct from context.organization_id
    or target.scope_key is distinct from context.organization_id::text
  );

update public.research_runs target
set organization_id = context.organization_id
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and target.organization_id is distinct from context.organization_id;

update public.research_run_items target
set organization_id = context.organization_id
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and target.organization_id is distinct from context.organization_id;

update public.messaging_drafts target
set organization_id = context.organization_id
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and target.organization_id is distinct from context.organization_id;

update public.messaging_draft_versions target
set organization_id = context.organization_id,
    payload = jsonb_set(
      target.payload,
      '{organizationId}',
      to_jsonb(context.organization_id::text),
      false
    )
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and (
    target.organization_id is distinct from context.organization_id
    or target.payload ->> 'organizationId' is distinct from context.organization_id::text
  );

update public.messaging_draft_generation_metadata target
set organization_id = context.organization_id
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and target.organization_id is distinct from context.organization_id;

update public.research_report_documents target
set organization_id = context.organization_id
from grupoexpro_research_context context
where target.user_id in (select user_id from grupoexpro_research_users)
  and target.organization_id is distinct from context.organization_id;

set local session_replication_role = origin;

do $$
declare
  v_context uuid := (select organization_id from grupoexpro_research_context);
begin
  if exists (
    select 1 from public.research_snapshots snapshot
    where snapshot.user_id in (select user_id from grupoexpro_research_users)
      and (snapshot.organization_id is distinct from v_context or snapshot.scope_key is distinct from v_context::text)
  ) then raise exception 'Research snapshot scope validation failed'; end if;

  if exists (
    select 1 from public.lead_research_jobs job
    where job.user_id in (select user_id from grupoexpro_research_users)
      and (
        job.organization_id is distinct from v_context
        or job.scope_key is distinct from v_context::text
        or (job.research_snapshot_id is not null and not exists (
          select 1 from public.research_snapshots snapshot
          where snapshot.id = job.research_snapshot_id
            and snapshot.organization_id = job.organization_id
            and snapshot.scope_key = job.scope_key
            and snapshot.user_id = job.user_id
        ))
      )
  ) then raise exception 'Research job graph validation failed'; end if;

  if exists (
    select 1 from public.research_run_items item
    where item.user_id in (select user_id from grupoexpro_research_users)
      and (
        item.organization_id is distinct from v_context
        or not exists (
          select 1 from public.research_runs run
          where run.id = item.run_id and run.organization_id = item.organization_id and run.user_id = item.user_id
        )
        or not exists (
          select 1 from public.lead_research_jobs job
          where job.id = item.job_id and job.organization_id = item.organization_id and job.user_id = item.user_id
        )
      )
  ) then raise exception 'Research run graph validation failed'; end if;

  if exists (
    select 1 from public.messaging_drafts draft
    where draft.user_id in (select user_id from grupoexpro_research_users)
      and (
        draft.organization_id is distinct from v_context
        or (draft.research_snapshot_id is not null and not exists (
          select 1 from public.research_snapshots snapshot
          where snapshot.id = draft.research_snapshot_id
            and snapshot.organization_id = draft.organization_id
            and snapshot.user_id = draft.user_id
        ))
      )
  ) then raise exception 'Messaging draft graph validation failed'; end if;

  if exists (
    select 1 from public.messaging_draft_versions version
    where version.user_id in (select user_id from grupoexpro_research_users)
      and (
        version.organization_id is distinct from v_context
        or version.payload ->> 'organizationId' is distinct from v_context::text
        or not exists (
          select 1 from public.messaging_drafts draft
          where draft.id = version.draft_id
            and draft.organization_id = version.organization_id
            and draft.user_id = version.user_id
        )
        or (version.research_snapshot_id is not null and not exists (
          select 1 from public.research_snapshots snapshot
          where snapshot.id = version.research_snapshot_id
            and snapshot.organization_id = version.organization_id
            and snapshot.user_id = version.user_id
        ))
      )
  ) then raise exception 'Messaging version graph validation failed'; end if;

  if exists (
    select 1 from public.messaging_draft_generation_metadata metadata
    where metadata.user_id in (select user_id from grupoexpro_research_users)
      and (
        metadata.organization_id is distinct from v_context
        or not exists (
          select 1 from public.messaging_draft_versions version
          where version.id = metadata.version_id
            and version.draft_id = metadata.draft_id
            and version.organization_id = metadata.organization_id
            and version.user_id = metadata.user_id
        )
      )
  ) then raise exception 'Draft metadata graph validation failed'; end if;

  if exists (
    select 1 from public.research_report_documents document
    where document.user_id in (select user_id from grupoexpro_research_users)
      and (
        document.organization_id is distinct from v_context
        or not exists (
          select 1 from public.research_snapshots snapshot
          where snapshot.id = document.research_snapshot_id
            and snapshot.organization_id = document.organization_id
            and snapshot.user_id = document.user_id
        )
      )
  ) then raise exception 'Research document graph validation failed'; end if;
end;
$$;

notify pgrst, 'reload schema';
