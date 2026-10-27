-- Leads adjudicados (27 de octubre de 2026), parte 1 de 2: la lectura.
-- Una persona que guarda un integrante de la organización (en Contactos o en «Por escribir») queda adjudicada a ese
-- integrante por 30 días, contados desde la primera vez que la guardó. Los demás la ven «Adjudicado a Ana · le quedan 12
-- días» y no pueden guardarla (parte 2, 20261027120100_lead_claims_enforce.sql). Si quien la guardó la borra o deja la
-- organización, deja de estar adjudicada. Esta parte solo lee: no cambia lo que se puede guardar.

-- A LinkedIn profile as the claim compares it: the handle after linkedin.com/in/, in lower case, without protocol, «www.»,
-- query or trailing slash. It takes a full URL or the «linkedin.com/in/handle» form the app sends.
create or replace function public.lead_claim_linkedin_v1(p_url text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select nullif(lower(substring(coalesce(p_url, '') from '(?i)linkedin\.com/in/([^/?#[:space:]]+)')), '')
$$;

-- Who holds each of these people in the organization, for anyone but p_user_id: among the members who saved the person, the
-- one whose first save is the earliest still within p_days. People are matched by email, provider id (Apollo) or LinkedIn.
-- Internal: the trigger of part 2 and lead_claims_v1 use it.
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
  with wanted as (
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
  saved as (
    select w.kind, w.key, l.user_id, l.created_at
      from wanted w
      join public.leads l
        on l.organization_id = p_organization_id and l.user_id is not null and l.user_id <> p_user_id
       and ((w.kind = 'email' and lower(trim(l.email)) = w.key)
         or (w.kind = 'provider' and (l.apollo_id = w.key or l.source_provider_id = w.key))
         or (w.kind = 'linkedin' and public.lead_claim_linkedin_v1(l.linkedin_url) = w.key))
    union all
    select w.kind, w.key, e.user_id, e.created_at
      from wanted w
      join public.enriched_leads e
        on e.organization_id = p_organization_id and e.user_id is not null and e.user_id <> p_user_id
       and ((w.kind = 'email' and lower(trim(e.email)) = w.key)
         or (w.kind = 'provider' and e.source_provider_id = w.key)
         or (w.kind = 'linkedin' and public.lead_claim_linkedin_v1(e.linkedin_url) = w.key))
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

-- The claims the app reads (the search, «Por escribir», Cowork and the extension). A person reads them only for their own
-- organization and as themselves; the server (service role, no auth.uid()) reads them for whoever it acts for.
create or replace function public.lead_claims_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_emails text[] default '{}'::text[],
  p_provider_ids text[] default '{}'::text[],
  p_linkedins text[] default '{}'::text[]
)
returns table (match_kind text, match_key text, owner_id uuid, owner_name text, claimed_at timestamptz, claimed_until timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is not null and (auth.uid() <> p_user_id or not exists (
    select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = auth.uid()
  )) then
    raise exception 'lead claims are read only for your own organization' using errcode = '42501';
  end if;
  return query select * from public.lead_claim_lookup_v1(p_organization_id, p_user_id,
    (coalesce(p_emails, '{}'::text[]))[1:200], (coalesce(p_provider_ids, '{}'::text[]))[1:200], (coalesce(p_linkedins, '{}'::text[]))[1:200]);
end;
$$;

revoke all on function public.lead_claims_v1(uuid, uuid, text[], text[], text[]) from public, anon;
grant execute on function public.lead_claims_v1(uuid, uuid, text[], text[], text[]) to authenticated, service_role;

-- «Por escribir» had no index by organization: the claims (and the team's reads) look people up within one.
create index if not exists enriched_leads_organization_id_idx on public.enriched_leads (organization_id);
