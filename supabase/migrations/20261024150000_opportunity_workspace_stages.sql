-- «Oportunidades» read by stage, as the pipeline draws them, and without a function call per row.
-- The stage is the team's work: «open» while nobody works it (no work record, or one left unassigned), otherwise its state. The
-- AI's evaluation narrows the open ones (recommended; review or pending; excluded), so «Por revisar» means the same in the list and
-- in the pipeline, and an opportunity leaves it when it gets a team or is put aside. Whether the person administers the workspace
-- is read once and a member reads only what they were assigned: the lists of opportunity_workspace_list* asked
-- opportunity_can_read for each of ~9,600 rows (577 ms for «Por revisar»; ~10 ms this way, with the same rows). Added beside those lists, which stay as
-- they are until the app stops calling them.
create index if not exists commercial_opportunities_org_score_idx on public.commercial_opportunities(organization_id,score desc,updated_at desc,id);

-- One page of the list, or of one stage of the pipeline. p_biddable keeps the open ones that can still be bid (no deadline or one
-- ahead); the ones a team works stay whatever their deadline. p_sort: priority (the score), deadline (soonest first), amount
-- (largest first) or recent (the last moved first: what was just put aside heads «Archivadas»).
create function public.opportunity_workspace_page(p_org uuid,p_user uuid,p_stages text[],p_evaluations text[],p_query text,p_kinds text[],
  p_terms text[],p_biddable boolean,p_sort text,p_limit integer,p_offset integer)
 returns setof public.commercial_opportunities language sql stable security definer set search_path=public,pg_temp as $$
 with viewer as materialized (select m.role in ('admin','owner') as admin from public.organization_members m where m.organization_id=p_org and m.user_id=p_user limit 1),
  words as (select '%'||left(replace(replace(coalesce(p_query,''),'%',''),'_',''),200)||'%' as query,
   array(select '%'||left(replace(replace(t,'%',''),'_',''),80)||'%' from unnest(coalesce(p_terms,'{}'::text[])) t) as terms)
 select o.* from public.commercial_opportunities o cross join words s
  left join public.opportunity_work w on w.organization_id=o.organization_id and w.opportunity_id=o.id
 where o.organization_id=p_org and exists(select 1 from viewer)
  and ((select admin from viewer) or exists(select 1 from public.opportunity_participants p where p.organization_id=p_org and p.opportunity_id=o.id and p.user_id=p_user))
  and (coalesce(cardinality(p_stages),0)=0 or (case when coalesce(w.state,'unassigned')='unassigned' then 'open' else w.state end)=any(p_stages))
  and (coalesce(cardinality(p_evaluations),0)=0 or coalesce(o.data->>'evaluation',case when o.kind='private' then 'review' end)=any(p_evaluations))
  and (coalesce(cardinality(p_kinds),0)=0 or o.kind=any(p_kinds))
  and (not coalesce(p_biddable,false) or coalesce(w.state,'unassigned')<>'unassigned' or o.deadline_at is null or o.deadline_at>now())
  and (coalesce(p_query,'')='' or o.title ilike s.query or o.company_name ilike s.query or o.buyer_name ilike s.query)
  and (cardinality(s.terms)=0 or o.title ilike any(s.terms) or coalesce(o.data->'summary'->>'text','') ilike any(s.terms))
 order by case when p_sort='deadline' then o.deadline_at end asc nulls last,case when p_sort='amount' then o.amount end desc nulls last,
  case when p_sort='recent' then coalesce(w.updated_at,o.updated_at) end desc nulls last,o.score desc,o.updated_at desc,o.id
 limit least(greatest(coalesce(p_limit,100),0),600) offset least(greatest(coalesce(p_offset,0),0),100000);
$$;

-- How many there are in each stage and, for the open ones, each evaluation, with the same words, sources and read rules.
create function public.opportunity_workspace_counts(p_org uuid,p_user uuid,p_query text,p_kinds text[],p_terms text[],p_biddable boolean)
 returns table(stage text,evaluation text,total bigint) language sql stable security definer set search_path=public,pg_temp as $$
 with viewer as materialized (select m.role in ('admin','owner') as admin from public.organization_members m where m.organization_id=p_org and m.user_id=p_user limit 1),
  words as (select '%'||left(replace(replace(coalesce(p_query,''),'%',''),'_',''),200)||'%' as query,
   array(select '%'||left(replace(replace(t,'%',''),'_',''),80)||'%' from unnest(coalesce(p_terms,'{}'::text[])) t) as terms)
 select case when coalesce(w.state,'unassigned')='unassigned' then 'open' else w.state end,
  coalesce(o.data->>'evaluation',case when o.kind='private' then 'review' end),count(*)
 from public.commercial_opportunities o cross join words s
  left join public.opportunity_work w on w.organization_id=o.organization_id and w.opportunity_id=o.id
 where o.organization_id=p_org and exists(select 1 from viewer)
  and ((select admin from viewer) or exists(select 1 from public.opportunity_participants p where p.organization_id=p_org and p.opportunity_id=o.id and p.user_id=p_user))
  and (coalesce(cardinality(p_kinds),0)=0 or o.kind=any(p_kinds))
  and (not coalesce(p_biddable,false) or coalesce(w.state,'unassigned')<>'unassigned' or o.deadline_at is null or o.deadline_at>now())
  and (coalesce(p_query,'')='' or o.title ilike s.query or o.company_name ilike s.query or o.buyer_name ilike s.query)
  and (cardinality(s.terms)=0 or o.title ilike any(s.terms) or coalesce(o.data->'summary'->>'text','') ilike any(s.terms))
 group by 1,2;
$$;
revoke all on function public.opportunity_workspace_page(uuid,uuid,text[],text[],text,text[],text[],boolean,text,integer,integer) from public,anon,authenticated;
revoke all on function public.opportunity_workspace_counts(uuid,uuid,text,text[],text[],boolean) from public,anon,authenticated;
grant execute on function public.opportunity_workspace_page(uuid,uuid,text[],text[],text,text[],text[],boolean,text,integer,integer) to service_role;
grant execute on function public.opportunity_workspace_counts(uuid,uuid,text,text[],text[],boolean) to service_role;
notify pgrst,'reload schema';
