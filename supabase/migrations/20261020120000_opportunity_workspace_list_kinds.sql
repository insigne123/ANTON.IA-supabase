-- «Oportunidades» by where they came from (licitaciones, Compra Ágil, LinkedIn, recibidas): the list of
-- opportunity_workspace_list with the kinds asked for, and the buyer also searched. Added beside it: the app calls it only
-- when a source is picked, so the page works the same before and after this migration.
create function public.opportunity_workspace_list_kinds(p_org uuid,p_user uuid,p_view text,p_query text,p_page integer,p_kinds text[])
 returns setof public.commercial_opportunities language sql stable security definer set search_path=public,pg_temp as $$
 select o.* from public.commercial_opportunities o left join public.opportunity_work w on w.opportunity_id=o.id and w.organization_id=o.organization_id
 where o.organization_id=p_org and public.opportunity_can_read(p_org,p_user,o.id)
  and (coalesce(cardinality(p_kinds),0)=0 or o.kind=any(p_kinds))
  and (coalesce(p_query,'')='' or o.title ilike '%'||left(p_query,200)||'%' or o.company_name ilike '%'||left(p_query,200)||'%' or o.buyer_name ilike '%'||left(p_query,200)||'%')
  and (p_view='all' or
    (public.is_organization_admin(p_org,p_user) and (case when p_view='assigned' then coalesce(w.state,'unassigned')<>'unassigned'
      else coalesce(o.data->>'evaluation',case when o.kind='private' then 'review' else 'pending' end)=p_view end)) or
    (not public.is_organization_admin(p_org,p_user) and (p_view in ('recommended','all') or coalesce(w.state,'assigned')=p_view)))
 order by o.score desc,o.updated_at desc,o.id limit 100 offset greatest(0,least(coalesce(p_page,0),1000))*100;
$$;
revoke all on function public.opportunity_workspace_list_kinds(uuid,uuid,text,text,integer,text[]) from public,anon,authenticated;
grant execute on function public.opportunity_workspace_list_kinds(uuid,uuid,text,text,integer,text[]) to service_role;
notify pgrst,'reload schema';
