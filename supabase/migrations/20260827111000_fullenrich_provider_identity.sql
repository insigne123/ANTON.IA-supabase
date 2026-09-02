-- Provider identifiers are external references, never primary keys for the
-- workspace. Keep legacy Apollo values readable while all new writes use
-- FullEnrich through source_provider/source_provider_id.
alter table public.leads
  add column if not exists source_provider text,
  add column if not exists source_provider_id text;

alter table public.enriched_leads
  add column if not exists source_provider text,
  add column if not exists source_provider_id text;

alter table public.enriched_opportunities
  add column if not exists source_provider text,
  add column if not exists source_provider_id text;

alter table public.people_search_leads
  add column if not exists source_provider text,
  add column if not exists source_provider_id text;

update public.leads
set source_provider = 'apollo',
    source_provider_id = apollo_id
where source_provider is null
  and nullif(trim(coalesce(apollo_id, '')), '') is not null;

update public.people_search_leads
set source_provider = 'apollo',
    source_provider_id = apollo_person_id
where source_provider is null
  and nullif(trim(coalesce(apollo_person_id, '')), '') is not null;

update public.enriched_leads
set source_provider = 'apollo',
    source_provider_id = nullif(trim(coalesce(data ->> 'apolloId', '')), '')
where source_provider is null
  and nullif(trim(coalesce(data ->> 'apolloId', '')), '') is not null;

update public.enriched_opportunities
set source_provider = 'apollo',
    source_provider_id = nullif(trim(coalesce(data ->> 'apolloId', '')), '')
where source_provider is null
  and nullif(trim(coalesce(data ->> 'apolloId', '')), '') is not null;

create index if not exists leads_source_provider_id_idx
  on public.leads (source_provider, source_provider_id)
  where source_provider is not null and source_provider_id is not null;

create index if not exists enriched_leads_source_provider_id_idx
  on public.enriched_leads (source_provider, source_provider_id)
  where source_provider is not null and source_provider_id is not null;

create index if not exists enriched_opportunities_source_provider_id_idx
  on public.enriched_opportunities (source_provider, source_provider_id)
  where source_provider is not null and source_provider_id is not null;

create index if not exists people_search_leads_source_provider_id_idx
  on public.people_search_leads (source_provider, source_provider_id)
  where source_provider is not null and source_provider_id is not null;

notify pgrst, 'reload schema';
