-- Leads adjudicados (27 de octubre de 2026), parte 2 de 2: el bloqueo.
-- Nadie puede guardar a una persona adjudicada a otro integrante de su organización (parte 1,
-- 20261027120000_lead_claims_lookup.sql), venga de donde venga: la búsqueda, Cowork, la extensión, una importación o el
-- contacto del día. El error lleva quién la tiene y hasta cuándo, y la app lo muestra así: «Adjudicado a Ana: le quedan
-- 12 días». Solo al insertar: quien ya la tenía guardada sigue con ella, y reasignar un contacto no cambia.

create or replace function public.enforce_lead_claim_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row jsonb := to_jsonb(new);
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
  if found then
    v_days := greatest(1, ceil(extract(epoch from (v_claim.claimed_until - now())) / 86400.0)::integer);
    raise exception 'lead_claimed'
      using errcode = 'P0001',
        detail = json_build_object('ownerName', v_claim.owner_name, 'claimedUntil', v_claim.claimed_until, 'daysLeft', v_days)::text,
        hint = format('Adjudicado a %s: le %s %s %s.', v_claim.owner_name,
          case when v_days = 1 then 'queda' else 'quedan' end, v_days, case when v_days = 1 then 'día' else 'días' end);
  end if;
  return new;
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
