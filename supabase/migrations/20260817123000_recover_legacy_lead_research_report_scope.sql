-- The external research backend can still write legacy report rows without
-- scope_key. Recover ownership from the enriched lead before NOT NULL checks.
create or replace function public.recover_lead_research_report_scope_key()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_owner_organization_id uuid;
  v_owner_user_id uuid;
begin
  new.scope_key := nullif(btrim(coalesce(new.scope_key, '')), '');
  if new.scope_key is not null then
    return new;
  end if;

  v_owner_organization_id := new.organization_id;
  v_owner_user_id := new.user_id;

  if v_owner_organization_id is null or v_owner_user_id is null then
    select e.organization_id, e.user_id
    into v_owner_organization_id, v_owner_user_id
    from public.enriched_leads e
    where e.id::text = nullif(btrim(coalesce(new.lead_id, '')), '')
       or e.id::text = nullif(btrim(coalesce(new.lead_ref, '')), '')
    order by e.updated_at desc nulls last
    limit 1;

    new.organization_id := coalesce(new.organization_id, v_owner_organization_id);
    new.user_id := coalesce(new.user_id, v_owner_user_id);
  end if;

  if new.organization_id is not null then
    new.scope_key := new.organization_id::text;
  elsif new.user_id is not null then
    new.scope_key := concat('user:', new.user_id::text);
  else
    raise exception 'lead research report requires a scope key or an owned lead reference'
      using errcode = '23502';
  end if;

  return new;
end;
$$;

drop trigger if exists recover_lead_research_report_scope_key on public.lead_research_reports;
create trigger recover_lead_research_report_scope_key
before insert or update of scope_key, organization_id, user_id, lead_ref, lead_id
on public.lead_research_reports
for each row
execute function public.recover_lead_research_report_scope_key();
