-- Leads adjudicados (28 de octubre de 2026): la lectura, por índices y sin lo que la persona ya tiene.
-- 1. Cada persona pedida se busca por igualdad en índices de la organización (correo, id del proveedor y LinkedIn). La versión
--    anterior leía todos los contactos de la organización en cada llamada (15 ms en la más grande), y el bloqueo la llama en cada
--    fila que se inserta: una importación de 1.000 filas pasaba el límite de 8 s por sentencia.
-- 2. Una persona que quien pregunta ya tiene guardada no le aparece adjudicada a otro: sigue trabajando con ella, como el bloqueo
--    ya le permite (20261027120100_lead_claims_enforce.sql). Antes la búsqueda y Cowork se la mostraban «Adjudicado a Ana».

create index if not exists leads_claim_email_idx on public.leads (organization_id, lower(trim(email)));
create index if not exists leads_claim_apollo_idx on public.leads (organization_id, (nullif(trim(apollo_id), '')));
create index if not exists leads_claim_source_provider_idx on public.leads (organization_id, (nullif(trim(source_provider_id), '')));
create index if not exists leads_claim_linkedin_idx on public.leads (organization_id, public.lead_claim_linkedin_v1(linkedin_url));
create index if not exists enriched_leads_claim_email_idx on public.enriched_leads (organization_id, lower(trim(email)));
create index if not exists enriched_leads_claim_source_provider_idx on public.enriched_leads (organization_id, (nullif(trim(source_provider_id), '')));
create index if not exists enriched_leads_claim_linkedin_idx on public.enriched_leads (organization_id, public.lead_claim_linkedin_v1(linkedin_url));

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
  -- Everyone in the organization who saved each person, the one asking included, found by key in the indexes.
  saved as materialized (
    select w.kind, w.key, l.user_id, l.created_at from wanted w join public.leads l
      on w.kind = 'email' and l.organization_id = p_organization_id and lower(trim(l.email)) = w.key
    union all
    select w.kind, w.key, l.user_id, l.created_at from wanted w join public.leads l
      on w.kind = 'provider' and l.organization_id = p_organization_id and nullif(trim(l.apollo_id), '') = w.key
    union all
    select w.kind, w.key, l.user_id, l.created_at from wanted w join public.leads l
      on w.kind = 'provider' and l.organization_id = p_organization_id and nullif(trim(l.source_provider_id), '') = w.key
    union all
    select w.kind, w.key, l.user_id, l.created_at from wanted w join public.leads l
      on w.kind = 'linkedin' and l.organization_id = p_organization_id and public.lead_claim_linkedin_v1(l.linkedin_url) = w.key
    union all
    select w.kind, w.key, e.user_id, e.created_at from wanted w join public.enriched_leads e
      on w.kind = 'email' and e.organization_id = p_organization_id and lower(trim(e.email)) = w.key
    union all
    select w.kind, w.key, e.user_id, e.created_at from wanted w join public.enriched_leads e
      on w.kind = 'provider' and e.organization_id = p_organization_id and nullif(trim(e.source_provider_id), '') = w.key
    union all
    select w.kind, w.key, e.user_id, e.created_at from wanted w join public.enriched_leads e
      on w.kind = 'linkedin' and e.organization_id = p_organization_id and public.lead_claim_linkedin_v1(e.linkedin_url) = w.key
  ),
  -- What the person asking already has: it is theirs to keep working with.
  mine as (
    select distinct kind, key from saved where user_id = p_user_id
  ),
  firsts as (
    select s.kind, s.key, s.user_id, min(s.created_at) as first_at
      from saved s
      where s.user_id is not null and s.user_id <> p_user_id
        and not exists (select 1 from mine m where m.kind = s.kind and m.key = s.key)
      group by s.kind, s.key, s.user_id
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
