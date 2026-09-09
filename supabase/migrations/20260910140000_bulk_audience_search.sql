-- Forward-only. Server-side audience search: history-aware, paginated, RLS-safe via service_role.
create function public.bulk_audience_norm_v1(value text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when nullif(trim(coalesce(value, '')), '') is null then null
    else translate(lower(trim(value)),
      'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc') end
$$;

create function public.bulk_audience_terms_match_v1(field text, terms text[]) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_term text; v_norm text;
begin
  if terms is null or coalesce(array_length(terms, 1), 0) = 0 then return true; end if;
  v_norm := public.bulk_audience_norm_v1(field);
  if v_norm is null then return false; end if;
  foreach v_term in array terms loop
    v_term := public.bulk_audience_norm_v1(v_term);
    if v_term is not null and v_norm like '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\' then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create function public.search_bulk_audience_v1(
  p_organization_id uuid, p_user_id uuid, p_relationship text,
  p_titles text[], p_industries text[], p_countries text[], p_sizes text[], p_seniorities text[],
  p_min_days integer, p_exclude_replied boolean, p_search text, p_limit integer, p_offset integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_norm_search text;
  v_total integer := 0;
  v_people jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists (
    select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_user_id
  ) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_relationship not in ('never_contacted', 'previously_contacted') then raise exception 'INVALID_AUDIENCE'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'INVALID_AUDIENCE_PAGE'; end if;
  if p_offset is null or p_offset < 0 then raise exception 'INVALID_AUDIENCE_PAGE'; end if;
  v_norm_search := public.bulk_audience_norm_v1(nullif(trim(coalesce(p_search, '')), ''));

  with sources as (
    select lower(trim(email)) as email, name, title, company, industry, country, ''::text as size, ''::text as seniority,
      id::text as lead_ref, 2 as priority
      from public.leads where organization_id = p_organization_id and nullif(trim(coalesce(email, '')), '') is not null
    union all
    select lower(trim(email)), full_name, title, company_name, organization_industry, country,
      coalesce(organization_size, ''), coalesce(seniority, ''), id::text, 1
      from public.enriched_leads where organization_id = p_organization_id and nullif(trim(coalesce(email, '')), '') is not null
    union all
    select lower(trim(email)), name, role, company, industry, country, ''::text, ''::text, id::text, 3
      from public.contacted_leads where organization_id = p_organization_id and nullif(trim(coalesce(email, '')), '') is not null
  ),
  candidates as (
    select email,
      max(name) filter (where nullif(trim(coalesce(name, '')), '') is not null) as name,
      max(title) filter (where nullif(trim(coalesce(title, '')), '') is not null) as title,
      max(company) filter (where nullif(trim(coalesce(company, '')), '') is not null) as company,
      max(industry) filter (where nullif(trim(coalesce(industry, '')), '') is not null) as industry,
      max(country) filter (where nullif(trim(coalesce(country, '')), '') is not null) as country,
      max(size) filter (where nullif(trim(coalesce(size, '')), '') is not null) as size,
      max(seniority) filter (where nullif(trim(coalesce(seniority, '')), '') is not null) as seniority,
      (array_agg(lead_ref order by priority))[1] as lead_ref,
      bool_or(priority = 3) as from_contacted
      from sources group by email
  ),
  history as (
    select lower(trim(email)) as email, true as contacted_any,
      max(case when status not in ('failed', 'unknown', 'pending', 'scheduled')
        then greatest(coalesce(sent_at, 'epoch'::timestamptz), coalesce(last_follow_up_at, 'epoch'::timestamptz)) end) as hist_last,
      bool_or(replied_at is not null or status = 'replied' or nullif(trim(coalesce(last_reply_text, '')), '') is not null) as replied,
      bool_or(campaign_followup_allowed is false or evaluation_status = 'do_not_contact' or status = 'do_not_contact'
        or bounced_at is not null or delivery_status in ('bounced', 'hard_bounced', 'soft_bounced')) as blocked_hist
      from public.contacted_leads where organization_id = p_organization_id group by lower(trim(email))
  ),
  dispatches as (
    select lower(metadata #>> '{recipient,email}') as email,
      max(completed_at) filter (where status = 'sent') as sent_last,
      bool_or(status in ('pending', 'sending', 'unknown')) as inflight
      from public.outbound_dispatches
      where organization_id = p_organization_id and channel = 'email'
        and nullif(trim(coalesce(metadata #>> '{recipient,email}', '')), '') is not null
      group by lower(metadata #>> '{recipient,email}')
  ),
  people as (
    select c.email, coalesce(c.name, '') as name, coalesce(c.company, '') as company, coalesce(c.title, '') as title,
      coalesce(c.industry, '') as industry, coalesce(c.country, '') as country,
      coalesce(c.size, '') as size, coalesce(c.seniority, '') as seniority, c.lead_ref,
      (coalesce(h.contacted_any, false) or d.sent_last is not null or coalesce(d.inflight, false)) as contacted,
      (select max(x) from (values (h.hist_last), (d.sent_last)) v(x)) as last_sent,
      coalesce(h.replied, false) as replied,
      case
        when coalesce(d.inflight, false) then 'Hay un envío pendiente de confirmación'
        when coalesce(h.blocked_hist, false) then 'No contactar o correo rebotado'
        when exists (select 1 from public.leads l where l.organization_id = p_organization_id
          and lower(trim(l.email)) = c.email and lower(coalesce(l.status, '')) = 'do_not_contact')
          then 'No contactar o correo rebotado'
        when exists (select 1 from public.unsubscribed_emails ue where lower(trim(ue.email)) = c.email
          and (ue.organization_id = p_organization_id or ue.user_id = p_user_id or (ue.organization_id is null and ue.user_id is null)))
          then 'El contacto se dio de baja'
        when exists (select 1 from public.excluded_domains where organization_id = p_organization_id
          and lower(domain) = split_part(c.email, '@', 2)) then 'El dominio está excluido'
        else null
      end as blocked_reason
      from candidates c
      left join history h on h.email = c.email
      left join dispatches d on d.email = c.email
  ),
  filtered as (
    select * from people p
      where (v_norm_search is null or p.email like '%' || replace(replace(replace(v_norm_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or public.bulk_audience_norm_v1(p.name) like '%' || replace(replace(replace(v_norm_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or public.bulk_audience_norm_v1(p.company) like '%' || replace(replace(replace(v_norm_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or public.bulk_audience_norm_v1(p.title) like '%' || replace(replace(replace(v_norm_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      and public.bulk_audience_terms_match_v1(p.title, p_titles)
      and public.bulk_audience_terms_match_v1(p.industry, p_industries)
      and public.bulk_audience_terms_match_v1(p.country, p_countries)
      and public.bulk_audience_terms_match_v1(p.size, p_sizes)
      and public.bulk_audience_terms_match_v1(p.seniority, p_seniorities)
      and case when p_relationship = 'never_contacted'
        then not p.contacted
        else p.contacted and p.last_sent is not null
          and p.last_sent <= now() - make_interval(days => coalesce(p_min_days, 0))
          and (not coalesce(p_exclude_replied, true) or not p.replied)
      end
  ),
  counted as (select count(*)::integer as total from filtered),
  page as (
    select f.* from filtered f order by f.email limit p_limit offset p_offset
  )
  select (select total from counted),
    coalesce((select jsonb_agg(jsonb_build_object(
      'email', email, 'name', name, 'company', company, 'title', title, 'industry', industry,
      'country', country, 'size', size, 'seniority', seniority, 'leadRef', lead_ref,
      'lastSentAt', case when last_sent is null then null else to_char(timezone('UTC', last_sent), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
      'contacted', contacted, 'replied', replied, 'blockedReason', blocked_reason, 'reasons', '[]'::jsonb
    ) order by email) from page), '[]'::jsonb)
    into v_total, v_people;
  return jsonb_build_object('total', v_total, 'people', v_people);
end;
$$;

revoke all on function public.search_bulk_audience_v1(uuid, uuid, text, text[], text[], text[], text[], text[], integer, boolean, text, integer, integer) from public, anon, authenticated;
grant execute on function public.search_bulk_audience_v1(uuid, uuid, text, text[], text[], text[], text[], text[], integer, boolean, text, integer, integer) to service_role;
revoke all on function public.bulk_audience_norm_v1(text) from public, anon, authenticated;
revoke all on function public.bulk_audience_terms_match_v1(text, text[]) from public, anon, authenticated;
