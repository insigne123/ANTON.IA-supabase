-- Move user-attributable lead and enrichment history into GrupoExpro while
-- preserving each row's original user_id.
set local lock_timeout = '10s';
set local statement_timeout = '2min';

lock table public.activity_logs, public.antonia_quota_operations,
  public.apollo_contact_subject_refs, public.apollo_enrichment_callbacks,
  public.enriched_leads, public.fullenrich_enrichment_callbacks, public.leads,
  public.organization_lead_collaboration, public.people_search_leads
  in share row exclusive mode;

create temporary table grupoexpro_lead_users (
  user_id uuid primary key
) on commit drop;

insert into grupoexpro_lead_users (user_id)
select id from auth.users
where lower(btrim(email)) ~ '^[^@[:space:]]+@grupoexpro[.]com$';

create temporary table grupoexpro_lead_context (
  organization_id uuid primary key
) on commit drop;

insert into grupoexpro_lead_context (organization_id)
select id from public.organizations where lower(btrim(name)) = 'grupoexpro';

do $$
declare
  v_check record;
  v_actual bigint;
begin
  if (select count(*) from grupoexpro_lead_users) <> 6
    or (select count(*) from grupoexpro_lead_context) <> 1 then
    raise exception 'GrupoExpro identity preflight failed';
  end if;

  for v_check in
    select * from (values
      ('activity_logs', 345::bigint),
      ('antonia_quota_operations', 63::bigint),
      ('apollo_contact_subject_refs', 66::bigint),
      ('apollo_enrichment_callbacks', 12::bigint),
      ('enriched_leads', 82::bigint),
      ('fullenrich_enrichment_callbacks', 9::bigint),
      ('leads', 247::bigint),
      ('people_search_leads', 8::bigint)
    ) expected(table_name, row_count)
  loop
    execute format(
      'select count(*) from public.%I where user_id in (select user_id from grupoexpro_lead_users)',
      v_check.table_name
    ) into v_actual;
    if v_actual <> v_check.row_count then
      raise exception 'Unexpected row count for public.%: expected %, found %',
        v_check.table_name, v_check.row_count, v_actual;
    end if;
  end loop;
end;
$$;

update public.activity_logs target
set organization_id = context.organization_id
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id;

update public.antonia_quota_operations target
set organization_id = context.organization_id
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id;

update public.enriched_leads target
set organization_id = context.organization_id
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id;

update public.people_search_leads target
set organization_id = context.organization_id::text
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id::text;

update public.apollo_contact_subject_refs target
set organization_id = context.organization_id::text
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id::text;

update public.apollo_enrichment_callbacks target
set organization_id = context.organization_id
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id;

update public.fullenrich_enrichment_callbacks target
set organization_id = context.organization_id
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id;

-- The collaboration trigger recreates immutable provenance in the new tenant.
update public.leads target
set organization_id = context.organization_id
from grupoexpro_lead_context context
where target.user_id in (select user_id from grupoexpro_lead_users)
  and target.organization_id is distinct from context.organization_id;

update public.organization_lead_collaboration collaboration
set assigned_to_user_id = lead.user_id,
    assigned_at = coalesce(collaboration.assigned_at, lead.created_at, now()),
    assigned_by_user_id = null
from public.leads lead
join grupoexpro_lead_users target on target.user_id = lead.user_id
cross join grupoexpro_lead_context context
where collaboration.lead_id = lead.id
  and collaboration.organization_id = context.organization_id;

do $$
declare
  v_context uuid := (select organization_id from grupoexpro_lead_context);
  v_table text;
  v_remaining bigint;
begin
  foreach v_table in array array[
    'activity_logs',
    'antonia_quota_operations',
    'enriched_leads',
    'apollo_enrichment_callbacks',
    'fullenrich_enrichment_callbacks',
    'leads'
  ]
  loop
    execute format(
      'select count(*) from public.%I where user_id in (select user_id from grupoexpro_lead_users) and organization_id is distinct from $1',
      v_table
    ) into v_remaining using v_context;
    if v_remaining <> 0 then
      raise exception 'Rows remain outside GrupoExpro in public.%: %', v_table, v_remaining;
    end if;
  end loop;

  foreach v_table in array array['people_search_leads', 'apollo_contact_subject_refs']
  loop
    execute format(
      'select count(*) from public.%I where user_id in (select user_id from grupoexpro_lead_users) and organization_id is distinct from $1',
      v_table
    ) into v_remaining using v_context::text;
    if v_remaining <> 0 then
      raise exception 'Rows remain outside GrupoExpro in public.%: %', v_table, v_remaining;
    end if;
  end loop;

  if exists (
    select 1
    from public.leads lead
    join grupoexpro_lead_users target on target.user_id = lead.user_id
    left join public.organization_lead_collaboration collaboration
      on collaboration.lead_id = lead.id
    where lead.organization_id is distinct from v_context
       or collaboration.lead_id is null
       or collaboration.organization_id is distinct from v_context
       or collaboration.discovered_by_user_id is distinct from lead.user_id
       or collaboration.assigned_to_user_id is distinct from lead.user_id
  ) then
    raise exception 'GrupoExpro lead attribution validation failed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
