-- Saved contacts whose surname the prospect search hid («Rafael Du***n») get the real name and LinkedIn from their own
-- email lookup (docs/contactos-identidad.md). From now on the app fills them at lookup time; this repairs the rows saved
-- before. Same person only: the lookup points at the saved contact (data.sourceSavedLeadId) or shares its provider
-- person id, inside the same user and organization. Only gaps: a hidden name and an empty LinkedIn.
with matched as (
  select distinct on (l.id) l.id, e.full_name, e.linkedin_url
  from public.leads l
  join public.enriched_leads e
    on e.user_id = l.user_id
   and e.organization_id is not distinct from l.organization_id
   and (
     e.data ->> 'sourceSavedLeadId' = l.id::text
     or (nullif(l.source_provider_id, '') is not null and e.source_provider_id = l.source_provider_id)
     or (nullif(l.apollo_id, '') is not null and e.source_provider_id = l.apollo_id)
   )
  where l.name like '%***%'
    and coalesce(e.full_name, '') <> ''
    and e.full_name not like '%***%'
  order by l.id, e.updated_at desc nulls last
)
update public.leads l
set name = m.full_name,
    linkedin_url = coalesce(nullif(l.linkedin_url, ''), nullif(m.linkedin_url, ''))
from matched m
where l.id = m.id
  and l.name like '%***%';
