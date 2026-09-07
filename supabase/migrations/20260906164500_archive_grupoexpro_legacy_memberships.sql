-- Retire GrupoExpro access from legacy personal organizations only after all
-- attributable tenant data has moved. A banned technical owner preserves them.
set local lock_timeout = '10s';
set local statement_timeout = '2min';

lock table auth.users, public.organizations, public.organization_members,
  public.organization_collaboration_events in share row exclusive mode;

create temporary table grupoexpro_archive_users (user_id uuid primary key) on commit drop;
insert into grupoexpro_archive_users (user_id)
select id from auth.users
where lower(btrim(email)) ~ '^[^@[:space:]]+@grupoexpro[.]com$';

create temporary table grupoexpro_archive_context (
  target_organization_id uuid primary key,
  archive_user_id uuid not null
) on commit drop;

insert into grupoexpro_archive_context (target_organization_id, archive_user_id)
select organization.id, archive.id
from public.organizations organization
cross join auth.users archive
where lower(btrim(organization.name)) = 'grupoexpro'
  and lower(btrim(archive.email)) = 'grupoexpro-archive@example.com';

create temporary table grupoexpro_legacy_organizations (
  organization_id uuid primary key
) on commit drop;

insert into grupoexpro_legacy_organizations (organization_id)
select distinct member.organization_id
from public.organization_members member
cross join grupoexpro_archive_context context
where member.user_id in (select user_id from grupoexpro_archive_users)
  and member.organization_id <> context.target_organization_id;

create temporary table grupoexpro_retired_memberships on commit drop as
select member.organization_id, member.user_id, member.role
from public.organization_members member
where member.organization_id in (select organization_id from grupoexpro_legacy_organizations)
  and member.user_id in (select user_id from grupoexpro_archive_users);

do $$
declare
  v_relation record;
  v_remaining bigint;
  v_archive_id uuid := (select archive_user_id from grupoexpro_archive_context);
begin
  if (select count(*) from grupoexpro_archive_users) <> 6
    or (select count(*) from grupoexpro_archive_context) <> 1
    or (select count(*) from grupoexpro_legacy_organizations) <> 3
    or (select count(*) from grupoexpro_retired_memberships) <> 5 then
    raise exception 'GrupoExpro archive preflight identity counts failed';
  end if;

  if not exists (
    select 1 from auth.users
    where id = v_archive_id
      and banned_until > now() + interval '99 years'
      and coalesce((raw_app_meta_data ->> 'technical_account')::boolean, false)
  ) then
    raise exception 'GrupoExpro archive custodian is not a blocked technical account';
  end if;

  for v_relation in
    select user_column.table_name
    from information_schema.columns user_column
    join information_schema.columns organization_column
      on organization_column.table_schema = user_column.table_schema
     and organization_column.table_name = user_column.table_name
     and organization_column.column_name = 'organization_id'
    where user_column.table_schema = 'public'
      and user_column.column_name = 'user_id'
      and user_column.table_name not in (
        'organization_members',
        'organization_reporting_group_members',
        'unsubscribed_emails'
      )
    order by user_column.table_name
  loop
    execute format(
      'select count(*) from public.%I where user_id in (select user_id from grupoexpro_archive_users) and organization_id::text in (select organization_id::text from grupoexpro_legacy_organizations)',
      v_relation.table_name
    ) into v_remaining;
    if v_remaining <> 0 then
      raise exception 'Cannot archive memberships: public.% retains % attributable rows',
        v_relation.table_name, v_remaining;
    end if;
  end loop;

  if exists (
    select 1 from public.antonia_event_ledger event
    where (
        event.actor_user_id in (select user_id from grupoexpro_archive_users)
        or event.initiated_by_user_id in (select user_id from grupoexpro_archive_users)
      )
      and event.organization_id in (select organization_id from grupoexpro_legacy_organizations)
  ) then
    raise exception 'Cannot archive memberships: attributable ledger events remain';
  end if;
end;
$$;

insert into public.organization_members (organization_id, user_id, role)
select legacy.organization_id, context.archive_user_id, 'owner'
from grupoexpro_legacy_organizations legacy
cross join grupoexpro_archive_context context
on conflict (organization_id, user_id) do update set role = 'owner';

select public.append_organization_collaboration_event_v1(
  legacy.organization_id,
  null,
  'organization.archive_custodian_added',
  'organization_member',
  context.archive_user_id::text,
  null,
  null,
  jsonb_build_object('reason', 'GrupoExpro historical consolidation')
)
from grupoexpro_legacy_organizations legacy
cross join grupoexpro_archive_context context;

select public.append_organization_collaboration_event_v1(
  retired.organization_id,
  null,
  'member.archived',
  'organization_member',
  retired.user_id::text,
  null,
  null,
  jsonb_build_object('previousRole', retired.role, 'targetOrganization', context.target_organization_id)
)
from grupoexpro_retired_memberships retired
cross join grupoexpro_archive_context context;

delete from public.organization_members member
using grupoexpro_retired_memberships retired
where member.organization_id = retired.organization_id
  and member.user_id = retired.user_id;

do $$
begin
  if exists (
    select 1
    from public.organization_members member
    where member.organization_id in (select organization_id from grupoexpro_legacy_organizations)
      and member.user_id in (select user_id from grupoexpro_archive_users)
  ) then
    raise exception 'GrupoExpro legacy memberships were not fully retired';
  end if;

  if exists (
    select 1
    from grupoexpro_legacy_organizations legacy
    cross join grupoexpro_archive_context context
    where not exists (
      select 1 from public.organization_members member
      where member.organization_id = legacy.organization_id
        and member.user_id = context.archive_user_id
        and member.role = 'owner'
    )
  ) then
    raise exception 'A legacy organization has no archive custodian owner';
  end if;
end;
$$;

notify pgrst, 'reload schema';
