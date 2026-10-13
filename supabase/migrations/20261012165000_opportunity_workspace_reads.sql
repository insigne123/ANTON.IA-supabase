-- Source lists are pageable and filtered before limiting. Members cannot ask the server for the unassigned catalogue.
create function public.opportunity_workspace_list(p_org uuid,p_user uuid,p_view text,p_query text,p_page integer)
 returns setof public.commercial_opportunities language sql stable security definer set search_path=public,pg_temp as $$
 select o.* from public.commercial_opportunities o left join public.opportunity_work w on w.opportunity_id=o.id and w.organization_id=o.organization_id
 where o.organization_id=p_org and public.opportunity_can_read(p_org,p_user,o.id)
  and (coalesce(p_query,'')='' or o.title ilike '%'||left(p_query,200)||'%' or o.company_name ilike '%'||left(p_query,200)||'%')
  and (p_view='all' or
    (public.is_organization_admin(p_org,p_user) and (case when p_view='assigned' then coalesce(w.state,'unassigned')<>'unassigned'
      else coalesce(o.data->>'evaluation',case when o.kind='private' then 'review' else 'pending' end)=p_view end)) or
    (not public.is_organization_admin(p_org,p_user) and (p_view in ('recommended','all') or coalesce(w.state,'assigned')=p_view)))
 order by o.score desc,o.updated_at desc,o.id limit 100 offset greatest(0,least(coalesce(p_page,0),1000))*100;
$$;
revoke all on function public.opportunity_workspace_list(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.opportunity_workspace_list(uuid,uuid,text,text,integer) to service_role;

create function public.opportunity_persist_candidates(p_job uuid,p_lease uuid,p_revision bigint,p_rows jsonb) returns uuid[]
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.opportunity_jobs; c jsonb; v_id uuid; v_data jsonb; v_ids uuid[]:='{}';
begin
 select * into j from public.opportunity_jobs where id=p_job and state='running' and lease_token=p_lease and lease_until>now() for update;
 if not found or not public.is_organization_admin(j.organization_id,j.requested_by) then raise exception 'OPPORTUNITY_LEASE_LOST'; end if;
 if not exists(select 1 from public.opportunity_company_context where organization_id=j.organization_id and revision=p_revision) then raise exception 'OPPORTUNITY_CONTEXT_CHANGED'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>100 then raise exception 'OPPORTUNITY_BAD_BATCH'; end if;
 for c in select value from jsonb_array_elements(p_rows) loop
  select id,data into v_id,v_data from public.commercial_opportunities where organization_id=j.organization_id and kind=c->>'kind' and dedupe_key=c->>'key' for update;
  if found and v_data->>'contentHash'=c->>'hash' and v_data->>'profileRevision'=p_revision::text then
   if v_data->>'evaluation'='pending' then v_ids:=array_append(v_ids,v_id); end if;
   continue;
  end if;
  v_data:=jsonb_build_object('origin','automatic','description',left(c->>'description',2400),'observed',coalesce(c->'raw','{}'::jsonb),
    'contentHash',c->>'hash','profileRevision',p_revision,'evaluation','pending','source',j.kind);
  insert into public.commercial_opportunities(organization_id,kind,dedupe_key,title,company_name,company_domain,buyer_name,deadline_at,amount,currency,url,data,reasons)
   values(j.organization_id,c->>'kind',c->>'key',left(c->>'title',500),c->>'company',c->>'domain',case when c->>'kind' in ('tender','compra_agil') then c->>'company' else null end,
     (c->>'deadline')::timestamptz,(c->>'amount')::numeric,c->>'currency',c->>'url',v_data,array['Pendiente de evaluación de afinidad'])
   on conflict(organization_id,kind,dedupe_key) do update set title=excluded.title,company_name=excluded.company_name,company_domain=excluded.company_domain,
    buyer_name=excluded.buyer_name,deadline_at=excluded.deadline_at,amount=excluded.amount,currency=excluded.currency,url=excluded.url,data=excluded.data,
    reasons=excluded.reasons,last_seen_at=now(),updated_at=now() returning id into v_id;
  v_ids:=array_append(v_ids,v_id);
 end loop;
 return v_ids;
end $$;
revoke all on function public.opportunity_persist_candidates(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.opportunity_persist_candidates(uuid,uuid,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
