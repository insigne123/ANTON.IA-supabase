-- Applied in production; immutable per-run revisions, version aligned to remote ledger.
create table public.cowork_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  organization_id uuid not null references public.organizations(id),
  created_at timestamptz not null default now(),
  unique(id,user_id,organization_id)
);
create table public.cowork_document_versions (
  document_id uuid not null,
  revision integer not null check(revision>0),
  run_id uuid not null unique,
  user_id uuid not null,
  organization_id uuid not null,
  title text not null check(length(title) between 1 and 160),
  content text not null check(length(content) between 1 and 40000),
  created_at timestamptz not null default now(),
  primary key(document_id,revision),
  foreign key(document_id,user_id,organization_id) references public.cowork_documents(id,user_id,organization_id),
  foreign key(run_id,user_id,organization_id) references public.cowork_runs(id,user_id,organization_id)
);
alter table public.cowork_documents enable row level security;
alter table public.cowork_document_versions enable row level security;
revoke all on public.cowork_documents,public.cowork_document_versions from anon,authenticated;
grant select on public.cowork_documents,public.cowork_document_versions to authenticated;
grant all on public.cowork_documents,public.cowork_document_versions to service_role;
create policy cowork_documents_private on public.cowork_documents for select to authenticated
  using(user_id=auth.uid() and public.cowork_has_access(organization_id));
create policy cowork_document_versions_private on public.cowork_document_versions for select to authenticated
  using(user_id=auth.uid() and public.cowork_has_access(organization_id));

alter function public.cowork_finish_run(uuid,uuid,text,jsonb) rename to cowork_finish_run_legacy;
revoke all on function public.cowork_finish_run_legacy(uuid,uuid,text,jsonb) from service_role;
create function public.cowork_finish_run(p_run_id uuid,p_token uuid,p_status text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs; document_uuid uuid; next_revision integer; doc jsonb;
begin
  if not public.cowork_finish_run_legacy(p_run_id,p_token,p_status,p_payload) then return false; end if;
  doc:=p_payload->'document';
  if p_status<>'completed' or doc is null or doc='null'::jsonb then return true; end if;
  if jsonb_typeof(doc)<>'object' or jsonb_typeof(doc->'title')<>'string' or jsonb_typeof(doc->'content')<>'string'
    or doc->>'title' is null or doc->>'content' is null then raise exception 'Invalid document'; end if;
  select * into r from public.cowork_runs where id=p_run_id;
  -- Reuse the immediate parent's artifact only; independent works get new IDs.
  select document_id into document_uuid from public.cowork_document_versions where run_id=r.parent_run_id
    and user_id=r.user_id and organization_id=r.organization_id;
  if document_uuid is null then
    insert into public.cowork_documents(user_id,organization_id) values(r.user_id,r.organization_id) returning id into document_uuid;
  end if;
  perform 1 from public.cowork_documents where id=document_uuid for update;
  select coalesce(max(revision),0)+1 into next_revision from public.cowork_document_versions where document_id=document_uuid;
  insert into public.cowork_document_versions(document_id,revision,run_id,user_id,organization_id,title,content)
    values(document_uuid,next_revision,r.id,r.user_id,r.organization_id,doc->>'title',doc->>'content');
  return true;
end; $$;
revoke all on function public.cowork_finish_run(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cowork_finish_run(uuid,uuid,text,jsonb) to service_role;
