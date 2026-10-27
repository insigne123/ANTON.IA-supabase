-- Leads adjudicados (27 de octubre de 2026), parte 2 de 2: el bloqueo.
-- Nadie puede guardar a una persona adjudicada a otro integrante de su organización (parte 1,
-- 20261027120000_lead_claims_lookup.sql), venga de donde venga: la búsqueda, Cowork, la extensión, una importación o el
-- contacto del día. El error lleva quién la tiene y hasta cuándo, y la app lo muestra así: «Adjudicado a Ana: le quedan
-- 12 días». Solo al insertar, y quien ya tiene guardada a la persona sigue trabajando con ella: actualizarla con un upsert
-- (así guarda «Por escribir» un enriquecimiento) o guardarla otra vez no se rechaza. Reasignar un contacto no cambia.

create or replace function public.enforce_lead_claim_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_email text := case when position('@' in coalesce(v_row->>'email', '')) > 1 then lower(trim(v_row->>'email')) end;
  v_providers text[] := array_remove(array[nullif(trim(v_row->>'apollo_id'), ''), nullif(trim(v_row->>'source_provider_id'), '')], null);
  v_linkedin text := public.lead_claim_linkedin_v1(v_row->>'linkedin_url');
  v_claim record;
  v_days integer;
begin
  if new.organization_id is null or new.user_id is null then
    return new;
  end if;
  select * into v_claim
    from public.lead_claim_lookup_v1(new.organization_id, new.user_id,
      array[v_row->>'email'], array[v_row->>'apollo_id', v_row->>'source_provider_id'], array[v_row->>'linkedin_url'])
    order by claimed_at asc
    limit 1;
  if not found then
    return new;
  end if;
  -- Someone who already has the person (their own row of this table being upserted, or a save of them in either table) adds
  -- nobody new to the team: they keep working with them. A claim that expired and passed to someone else does not take
  -- away what they already had.
  if exists (
    select 1 from public.leads l
     where l.organization_id = new.organization_id and l.user_id = new.user_id
       and ((tg_table_name = 'leads' and l.id::text = v_row->>'id') or lower(trim(l.email)) = v_email
         or nullif(trim(l.apollo_id), '') = any(v_providers) or nullif(trim(l.source_provider_id), '') = any(v_providers)
         or public.lead_claim_linkedin_v1(l.linkedin_url) = v_linkedin)
  ) or exists (
    select 1 from public.enriched_leads e
     where e.organization_id = new.organization_id and e.user_id = new.user_id
       and ((tg_table_name = 'enriched_leads' and e.id = v_row->>'id') or lower(trim(e.email)) = v_email
         or nullif(trim(e.source_provider_id), '') = any(v_providers)
         or public.lead_claim_linkedin_v1(e.linkedin_url) = v_linkedin)
  ) then
    return new;
  end if;
  v_days := greatest(1, ceil(extract(epoch from (v_claim.claimed_until - now())) / 86400.0)::integer);
  raise exception 'lead_claimed'
    using errcode = 'P0001',
      detail = json_build_object('ownerName', v_claim.owner_name, 'claimedUntil', v_claim.claimed_until, 'daysLeft', v_days)::text,
      hint = format('Adjudicado a %s: le %s %s %s.', v_claim.owner_name,
        case when v_days = 1 then 'queda' else 'quedan' end, v_days, case when v_days = 1 then 'día' else 'días' end);
end;
$$;

revoke all on function public.enforce_lead_claim_v1() from public, anon, authenticated;

drop trigger if exists enforce_lead_claim on public.leads;
create trigger enforce_lead_claim
  before insert on public.leads
  for each row execute function public.enforce_lead_claim_v1();

drop trigger if exists enforce_lead_claim on public.enriched_leads;
create trigger enforce_lead_claim
  before insert on public.enriched_leads
  for each row execute function public.enforce_lead_claim_v1();
