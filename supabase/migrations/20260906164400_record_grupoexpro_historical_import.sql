-- Record one immutable completion event per imported identity after every
-- tenant-scoped postcondition has passed.
select public.append_organization_collaboration_event_v1(
  organization.id,
  null,
  'historical_import.completed',
  'organization_member',
  target.id::text,
  null,
  null,
  jsonb_build_object(
    'sourceUserId', target.id,
    'email', lower(btrim(target.email)),
    'leadCount', (select count(*) from public.leads where user_id = target.id),
    'enrichedLeadCount', (select count(*) from public.enriched_leads where user_id = target.id),
    'researchJobCount', (select count(*) from public.lead_research_jobs where user_id = target.id)
  )
)
from auth.users target
cross join public.organizations organization
where lower(btrim(target.email)) ~ '^[^@[:space:]]+@grupoexpro[.]com$'
  and lower(btrim(organization.name)) = 'grupoexpro'
  and not exists (
    select 1
    from public.organization_collaboration_events event
    where event.organization_id = organization.id
      and event.event_type = 'historical_import.completed'
      and event.entity_type = 'organization_member'
      and event.entity_id = target.id::text
  );

do $$
declare
  v_organization_id uuid;
begin
  select id into strict v_organization_id
  from public.organizations
  where lower(btrim(name)) = 'grupoexpro';

  if (
    select count(*)
    from public.organization_collaboration_events
    where organization_id = v_organization_id
      and event_type = 'historical_import.completed'
      and entity_type = 'organization_member'
  ) <> 6 then
    raise exception 'Expected one historical import event per GrupoExpro user';
  end if;
end;
$$;
