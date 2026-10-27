-- Leads adjudicados (27 de octubre de 2026): la lectura, más rápida. La primera versión comparaba cada persona pedida con
-- cada contacto de la organización y normalizaba su LinkedIn en cada comparación: 1,2 s para una página grande en
-- GrupoExpro. Ahora normaliza una vez los contactos de la organización y los cruza por igualdad. Mismo resultado.

create or replace function public.lead_claim_lookup_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_emails text[],
  p_provider_ids text[],
  p_linkedins text[],
  p_days integer default 30
)
returns table (match_kind text, match_key text, owner_id uuid, owner_name text, claimed_at timestamptz, claimed_until timestamptz)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with wanted as materialized (
    select 'email'::text as kind, lower(trim(value)) as key
      from unnest(coalesce(p_emails, '{}'::text[])) as value
      where position('@' in coalesce(value, '')) > 1
    union
    select 'provider'::text, trim(value)
      from unnest(coalesce(p_provider_ids, '{}'::text[])) as value
      where trim(coalesce(value, '')) <> ''
    union
    select 'linkedin'::text, public.lead_claim_linkedin_v1(value)
      from unnest(coalesce(p_linkedins, '{}'::text[])) as value
      where public.lead_claim_linkedin_v1(value) is not null
  ),
  -- Each contact of the organization saved by someone else, its keys normalized once.
  held as materialized (
    select l.user_id, l.created_at, lower(trim(l.email)) as email, nullif(trim(l.apollo_id), '') as provider,
      nullif(trim(l.source_provider_id), '') as source_provider, public.lead_claim_linkedin_v1(l.linkedin_url) as linkedin
      from public.leads l
      where l.organization_id = p_organization_id and l.user_id is not null and l.user_id <> p_user_id
    union all
    select e.user_id, e.created_at, lower(trim(e.email)), null, nullif(trim(e.source_provider_id), ''), public.lead_claim_linkedin_v1(e.linkedin_url)
      from public.enriched_leads e
      where e.organization_id = p_organization_id and e.user_id is not null and e.user_id <> p_user_id
  ),
  saved as (
    select w.kind, w.key, h.user_id, h.created_at from wanted w join held h on w.kind = 'email' and h.email = w.key
    union all
    select w.kind, w.key, h.user_id, h.created_at from wanted w join held h on w.kind = 'provider' and h.provider = w.key
    union all
    select w.kind, w.key, h.user_id, h.created_at from wanted w join held h on w.kind = 'provider' and h.source_provider = w.key
    union all
    select w.kind, w.key, h.user_id, h.created_at from wanted w join held h on w.kind = 'linkedin' and h.linkedin = w.key
  ),
  firsts as (
    select kind, key, user_id, min(created_at) as first_at from saved group by kind, key, user_id
  )
  select distinct on (f.kind, f.key)
    f.kind, f.key, f.user_id,
    coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Otra persona del equipo'),
    f.first_at, f.first_at + make_interval(days => greatest(1, coalesce(p_days, 30)))
  from firsts f
  join public.organization_members m on m.organization_id = p_organization_id and m.user_id = f.user_id
  left join public.profiles p on p.id = f.user_id
  where f.first_at + make_interval(days => greatest(1, coalesce(p_days, 30))) > now()
  order by f.kind, f.key, f.first_at asc
$$;

revoke all on function public.lead_claim_lookup_v1(uuid, uuid, text[], text[], text[], integer) from public, anon, authenticated;
grant execute on function public.lead_claim_lookup_v1(uuid, uuid, text[], text[], text[], integer) to service_role;
