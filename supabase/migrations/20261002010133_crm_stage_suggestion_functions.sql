-- Plan 5, PR-10: the functions of the stage suggestions (table in 20261002005957_crm_stage_suggestions.sql).
-- Events (service role): leaves or raises the pending suggestion of a lead. Returns its id, or null when nothing is
-- suggested (unknown lead, same stage, a backward move or a closed lead).
create or replace function public.suggest_crm_stage_v1(
  p_organization_id uuid,
  p_lead_ref text,
  p_to_stage text,
  p_reason text,
  p_source text,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text[] := array['inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation', 'closed_won'];
  v_ref text := trim(coalesce(p_lead_ref, ''));
  v_crm_id text;
  v_current text;
  v_id uuid;
begin
  if p_organization_id is null or v_ref = '' or p_to_stage is null
    or not (p_to_stage = any(v_order) or p_to_stage = 'closed_lost') then
    raise exception 'Invalid stage suggestion' using errcode = '22023';
  end if;

  if v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from public.leads l where l.id = v_ref::uuid and l.organization_id = p_organization_id) then
    v_crm_id := 'lead_saved|' || v_ref;
  elsif exists (select 1 from public.enriched_leads e where e.id = v_ref and e.organization_id = p_organization_id) then
    v_crm_id := 'lead_enriched|' || v_ref;
  else
    return null;
  end if;

  select c.stage into v_current from public.unified_crm_data c
  where c.id = v_crm_id and c.organization_id = p_organization_id;
  if v_current in ('closed_won', 'closed_lost') or v_current is not distinct from p_to_stage then return null; end if;
  if p_to_stage <> 'closed_lost'
    and array_position(v_order, p_to_stage) <= coalesce(array_position(v_order, v_current), 1) then
    return null;
  end if;

  insert into public.crm_stage_suggestions as s (organization_id, crm_id, from_stage, to_stage, reason, source, evidence)
  values (
    p_organization_id, v_crm_id, v_current, p_to_stage,
    left(coalesce(nullif(trim(p_reason), ''), 'Evento registrado'), 500),
    left(coalesce(nullif(trim(p_source), ''), 'event'), 80),
    case when jsonb_typeof(p_evidence) = 'object' then p_evidence else '{}'::jsonb end
  )
  on conflict (organization_id, crm_id) where status = 'pending'
  do update set from_stage = excluded.from_stage,
                to_stage = excluded.to_stage,
                reason = excluded.reason,
                source = excluded.source,
                evidence = excluded.evidence,
                updated_at = now()
  where excluded.to_stage = 'closed_lost'
     or coalesce(array_position(v_order, excluded.to_stage), 0)
        > coalesce(array_position(v_order, s.to_stage), 0)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.suggest_crm_stage_v1(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.suggest_crm_stage_v1(uuid, text, text, text, text, jsonb) to service_role;

-- People (members): accept or dismiss pending suggestions. Accepting moves the stage unless the lead already moved
-- past it by hand or was closed; then the suggestion is superseded and nothing moves back.
create or replace function public.decide_crm_stage_suggestions_v1(p_ids uuid[], p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text[] := array['inbox', 'qualified', 'contacted', 'engaged', 'meeting', 'negotiation', 'closed_won'];
  v_row public.crm_stage_suggestions%rowtype;
  v_current text;
  v_status text;
  v_accepted integer := 0;
  v_dismissed integer := 0;
  v_superseded integer := 0;
begin
  if p_decision not in ('accept', 'dismiss') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 500 then
    raise exception 'Invalid selection' using errcode = '22023';
  end if;
  if auth.uid() is null then raise exception 'not authorized' using errcode = '42501'; end if;

  for v_row in
    select * from public.crm_stage_suggestions
    where id = any(p_ids) and status = 'pending'
    order by created_at
    for update
  loop
    if not public.organization_has_role_v1(v_row.organization_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_status := 'dismissed';
    if p_decision = 'accept' then
      select c.stage into v_current from public.unified_crm_data c
      where c.id = v_row.crm_id and c.organization_id = v_row.organization_id;
      if v_current in ('closed_won', 'closed_lost') or v_current is not distinct from v_row.to_stage
        or (v_row.to_stage <> 'closed_lost'
            and array_position(v_order, v_row.to_stage) <= coalesce(array_position(v_order, v_current), 1)) then
        v_status := 'superseded';
      else
        insert into public.unified_crm_data (id, organization_id, stage, updated_at)
        values (v_row.crm_id, v_row.organization_id, v_row.to_stage, now())
        on conflict (id) do update set stage = excluded.stage, updated_at = excluded.updated_at
        where public.unified_crm_data.organization_id = v_row.organization_id;
        v_status := 'accepted';
      end if;
    end if;
    update public.crm_stage_suggestions
    set status = v_status, decided_at = now(), decided_by = auth.uid(), updated_at = now()
    where id = v_row.id;
    if v_status = 'accepted' then v_accepted := v_accepted + 1;
    elsif v_status = 'superseded' then v_superseded := v_superseded + 1;
    else v_dismissed := v_dismissed + 1;
    end if;
  end loop;

  return jsonb_build_object('accepted', v_accepted, 'dismissed', v_dismissed, 'superseded', v_superseded);
end;
$$;

revoke all on function public.decide_crm_stage_suggestions_v1(uuid[], text) from public, anon;
grant execute on function public.decide_crm_stage_suggestions_v1(uuid[], text) to authenticated, service_role;

notify pgrst, 'reload schema';
