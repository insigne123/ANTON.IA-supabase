create table public.opportunity_documents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 name text not null check(length(name) between 1 and 300), mime text not null, sha256 text not null check(length(sha256)=64),
 storage_path text, source_url text, source_kind text not null check(source_kind in ('upload','pasted','official','public_web')),
 bytes integer not null check(bytes between 0 and 20971520), pages_total integer, pages_read integer not null default 0,
 extraction_status text not null default 'pending' check(extraction_status in ('pending','read','partial','scan','unavailable','damaged')),
 uploaded_by uuid references auth.users(id), created_at timestamptz not null default now(),
 unique(opportunity_id,sha256),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create table public.opportunity_document_chunks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 document_id uuid not null references public.opportunity_documents(id) on delete cascade,
 ordinal integer not null, locator text not null, content text not null check(length(content)<=12000),
 fts tsvector generated always as (to_tsvector('spanish',content)) stored,
 unique(document_id,ordinal),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create unique index opportunity_documents_tenant_id_idx on public.opportunity_documents(organization_id,opportunity_id,id);
alter table public.opportunity_document_chunks add constraint opportunity_chunks_document_scope_fk
 foreign key(organization_id,opportunity_id,document_id) references public.opportunity_documents(organization_id,opportunity_id,id) on delete cascade;
create index opportunity_document_chunks_fts_idx on public.opportunity_document_chunks using gin(fts);
create table public.opportunity_reports (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 job_id uuid not null unique references public.opportunity_jobs(id), content_hash text not null, profile_revision bigint not null,
 report jsonb not null check(pg_column_size(report)<=2097152), created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create table public.opportunity_chat_messages (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 user_id uuid not null references auth.users(id), request_id uuid not null, question text not null check(length(question)<=2000),
 answer jsonb, report_id uuid references public.opportunity_reports(id), created_at timestamptz not null default now(),
 unique(organization_id,user_id,request_id),
 foreign key(organization_id,opportunity_id) references public.commercial_opportunities(organization_id,id) on delete cascade
);
create function public.opportunity_finish_job(p_id uuid,p_lease uuid,p_state text,p_result jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.opportunity_jobs;
begin
 select * into j from public.opportunity_jobs where id=p_id and state='running' and lease_token=p_lease and lease_until>now() for update;
 if not found then return false; end if;
 if p_state not in ('ready','waiting','failed','blocked','cancelled') then raise exception 'OPPORTUNITY_BAD_STATE'; end if;
 if p_state='ready' and j.kind='research' then
  if not public.opportunity_can_read(j.organization_id,j.requested_by,j.opportunity_id) then raise exception 'OPPORTUNITY_ACCESS_REVOKED'; end if;
  if not exists(select 1 from public.opportunity_company_context where organization_id=j.organization_id and revision=(j.payload->>'profileRevision')::bigint) then raise exception 'OPPORTUNITY_CONTEXT_CHANGED'; end if;
  insert into public.opportunity_reports(organization_id,opportunity_id,job_id,content_hash,profile_revision,report,created_by)
   values(j.organization_id,j.opportunity_id,j.id,j.payload->>'contentHash',(j.payload->>'profileRevision')::bigint,p_result,j.requested_by) on conflict(job_id) do nothing;
  insert into public.opportunity_activity(organization_id,opportunity_id,actor_id,kind,body,event_key)
   values(j.organization_id,j.opportunity_id,j.requested_by,'report_ready','Informe de investigación disponible','report:'||j.id) on conflict(organization_id,event_key) do nothing;
  insert into public.opportunity_notifications(organization_id,opportunity_id,user_id,title,kind,event_key)
   select j.organization_id,j.opportunity_id,p.user_id,'Informe disponible: '||left(o.title,470),'report','report:'||j.id
   from public.opportunity_participants p join public.commercial_opportunities o on o.organization_id=p.organization_id and o.id=p.opportunity_id
   where p.organization_id=j.organization_id and p.opportunity_id=j.opportunity_id
   on conflict(organization_id,user_id,event_key) do nothing;
 end if;
 if p_state='ready' and j.kind='chat' then
  if not public.opportunity_can_read(j.organization_id,j.requested_by,j.opportunity_id) then raise exception 'OPPORTUNITY_ACCESS_REVOKED'; end if;
  update public.opportunity_chat_messages set answer=p_result where organization_id=j.organization_id and user_id=j.requested_by and request_id=(j.payload->>'requestId')::uuid and opportunity_id=j.opportunity_id;
 end if;
 update public.opportunity_jobs set state=p_state,result=p_result,error=left(p_error,500),lease_until=null,lease_token=null,updated_at=now() where id=p_id;
 return true;
end $$;
create function public.opportunity_search_chunks(p_org uuid,p_user uuid,p_id uuid,p_query text) returns setof public.opportunity_document_chunks
language sql stable security definer set search_path=public,pg_temp as $$
 select c.* from public.opportunity_document_chunks c where c.organization_id=p_org and c.opportunity_id=p_id
  and public.opportunity_can_read(p_org,p_user,p_id) and c.fts@@websearch_to_tsquery('spanish',left(p_query,2000))
 order by ts_rank(c.fts,websearch_to_tsquery('spanish',left(p_query,2000))) desc,c.ordinal limit 12;
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('opportunity-documents','opportunity-documents',false,20971520,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/markdown','text/csv','text/html'])
 on conflict(id) do nothing;
-- Restrictive policy protects this new bucket even if an older permissive Storage policy is broad.
create policy opportunity_objects_server_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'opportunity-documents') with check(bucket_id<>'opportunity-documents');
do $$ declare t text; begin
 foreach t in array array['opportunity_documents','opportunity_document_chunks','opportunity_reports','opportunity_chat_messages'] loop
  execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function public.opportunity_finish_job(uuid,uuid,text,jsonb,text),public.opportunity_search_chunks(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.opportunity_finish_job(uuid,uuid,text,jsonb,text),public.opportunity_search_chunks(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
