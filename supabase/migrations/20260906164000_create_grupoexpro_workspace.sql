-- Create the shared workspace from the empty organization provisioned for its
-- invited owner. Historical data and legacy memberships move separately.
set local lock_timeout = '10s';
set local statement_timeout = '2min';

lock table auth.users, public.organizations, public.organization_members,
  public.organization_reporting_groups in share row exclusive mode;

create temporary table grupoexpro_workspace_users (
  user_id uuid primary key,
  email text not null unique
) on commit drop;

insert into grupoexpro_workspace_users (user_id, email)
select id, lower(btrim(email))
from auth.users
where lower(btrim(email)) ~ '^[^@[:space:]]+@grupoexpro[.]com$';

do $$
declare
  v_manager_id uuid;
  v_organization_id uuid;
  v_owner_count integer;
  v_member_count integer;
  v_relation record;
  v_row_count bigint;
begin
  if (select count(*) from grupoexpro_workspace_users) <> 6 then
    raise exception 'Expected exactly 6 GrupoExpro users, found %',
      (select count(*) from grupoexpro_workspace_users);
  end if;

  select user_id into strict v_manager_id
  from grupoexpro_workspace_users
  where email = 'gmeneses@grupoexpro.com';

  select count(*) into v_owner_count
  from public.organization_members
  where user_id = v_manager_id and role = 'owner';
  if v_owner_count <> 1 then
    raise exception 'Expected one manager-owned workspace, found %', v_owner_count;
  end if;

  select organization_id into strict v_organization_id
  from public.organization_members
  where user_id = v_manager_id and role = 'owner';

  if exists (
    select 1 from public.organizations
    where lower(btrim(name)) = 'grupoexpro' and id <> v_organization_id
  ) then
    raise exception 'A different organization is already named GrupoExpro';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = v_organization_id and lower(btrim(name)) = 'grupoexpro'
  ) then
    select count(*) into v_member_count
    from public.organization_members
    where organization_id = v_organization_id;
    if v_member_count <> 1 then
      raise exception 'Manager workspace is not a single-member personal organization';
    end if;

    -- Signup can create activity and derived event rows. Every other scoped
    -- table must be empty before this organization becomes the shared tenant.
    for v_relation in
      select relation.relname as table_name
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p')
        and relation.relname not in (
          'activity_logs',
          'antonia_event_ledger',
          'antonia_event_rollups_daily',
          'organization_members'
        )
        and exists (
          select 1 from pg_attribute attribute
          where attribute.attrelid = relation.oid
            and attribute.attname = 'organization_id'
            and attribute.attnum > 0
            and not attribute.attisdropped
        )
      order by relation.relname
    loop
      execute format(
        'select count(*) from public.%I where organization_id::text = $1',
        v_relation.table_name
      ) into v_row_count using v_organization_id::text;
      if v_row_count <> 0 then
        raise exception 'Manager workspace is not empty: public.% contains % rows',
          v_relation.table_name,
          v_row_count;
      end if;
    end loop;

    update public.organizations set name = 'GrupoExpro'
    where id = v_organization_id;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  select
    v_organization_id,
    target.user_id,
    case when target.user_id = v_manager_id then 'owner' else 'member' end
  from grupoexpro_workspace_users target
  on conflict (organization_id, user_id) do update
  set role = excluded.role;

  insert into public.organization_reporting_groups (
    organization_id, name, slug, country_code, color
  ) values
    (v_organization_id, 'Chile', 'chile', 'CL', '#2563eb'),
    (v_organization_id, 'Peru', 'peru', 'PE', '#0f766e'),
    (v_organization_id, 'Colombia', 'colombia', 'CO', '#d97706')
  on conflict (organization_id, slug) do nothing;

  if (
    select count(*) from public.organization_members
    where organization_id = v_organization_id
      and user_id in (select user_id from grupoexpro_workspace_users)
  ) <> 6 then
    raise exception 'GrupoExpro memberships are incomplete';
  end if;
end;
$$;

notify pgrst, 'reload schema';
