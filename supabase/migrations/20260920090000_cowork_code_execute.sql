-- Fase 3: code execution effect vocabulary, staged code proposals, and private
-- file buckets. Each addition only widens allowed vocabulary or adds new
-- objects; nothing existing is altered or granted.
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute'));

-- The RPC must accept the same vocabulary as the table constraint.
create or replace function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind is null or p_kind not in ('save_contact','start_research','request_draft','enrich_contact',
    'send_email','campaign_create','campaign_activate','campaign_pause','code_execute') then
    raise exception 'Unknown effect' using errcode='22023';
  end if;
  if p_target_id is null or length(trim(p_target_id)) = 0 or length(p_target_id) > 300 then raise exception 'Invalid target' using errcode='22023'; end if;
  if p_label is null or length(trim(p_label)) = 0 or length(p_label) > 280 then raise exception 'Invalid label' using errcode='22023'; end if;
  select * into r from public.cowork_runs where id=p_run_id and status='running' and lease_token=p_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.cowork_access_grants g join auth.users u on u.id=g.user_id join public.organization_members m on m.user_id=u.id
    where g.user_id=r.user_id and g.enabled and lower(trim(u.email))='nicolas.yarur.g@yago.cl' and u.email_confirmed_at is not null and m.organization_id=r.organization_id) then return false; end if;
  if p_origin_run_id is null then raise exception 'Origin unavailable' using errcode='22023'; end if;
  if p_origin_run_id <> p_run_id then
    perform 1 from public.cowork_runs where id=p_origin_run_id and user_id=r.user_id and organization_id=r.organization_id and status='completed';
    if not found then raise exception 'Origin unavailable' using errcode='22023'; end if;
  end if;
  insert into public.cowork_effect_proposals(run_id,user_id,organization_id,kind,origin_run_id,target_id,label)
    values(r.id,r.user_id,r.organization_id,p_kind,p_origin_run_id,trim(p_target_id),trim(p_label));
  update public.cowork_runs set status='waiting_approval',lease_token=null,lease_expires_at=null,updated_at=now() where id=r.id;
  insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload)
    values(r.id,r.user_id,r.organization_id,'approval.requested',
      jsonb_build_object('action','cowork.effect','kind',p_kind,'targetId',trim(p_target_id),'label',trim(p_label)));
  return true;
end; $$;
revoke all on function public.cowork_propose_effect(uuid,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cowork_propose_effect(uuid,uuid,text,uuid,text,text) to service_role;

-- Staged code reviewed by the owner. Written once by the worker at propose
-- time (service_role), read exactly once at execution; the generic effect
-- machinery owns approve/reject/single-execution.
create table public.cowork_code_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  language text not null check (language in ('python', 'node')),
  code text not null check (length(code) between 1 and 12288),
  input_files jsonb not null default '[]'::jsonb,
  code_hash text not null check (length(code_hash) = 64),
  created_at timestamptz not null default now()
);
alter table public.cowork_code_proposals enable row level security;
revoke all on public.cowork_code_proposals from anon, authenticated;
grant select on public.cowork_code_proposals to authenticated;
grant all on public.cowork_code_proposals to service_role;
create policy cowork_code_proposals_private on public.cowork_code_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

-- Private file buckets. Paths are {organization_id}/{user_id}/...; policies
-- fail closed on malformed paths. The worker uses service_role.
insert into storage.buckets (id, name, public)
  values ('cowork-uploads', 'cowork-uploads', false), ('cowork-artifacts', 'cowork-artifacts', false)
  on conflict (id) do nothing;

create policy cowork_files_private_select on storage.objects for select to authenticated
  using (bucket_id in ('cowork-uploads', 'cowork-artifacts')
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.cowork_has_access(((storage.foldername(name))[1])::uuid));
create policy cowork_files_private_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('cowork-uploads', 'cowork-artifacts')
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.cowork_has_access(((storage.foldername(name))[1])::uuid));
create policy cowork_files_private_update on storage.objects for update to authenticated
  using (bucket_id in ('cowork-uploads', 'cowork-artifacts')
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.cowork_has_access(((storage.foldername(name))[1])::uuid));
create policy cowork_files_private_delete on storage.objects for delete to authenticated
  using (bucket_id in ('cowork-uploads', 'cowork-artifacts')
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.cowork_has_access(((storage.foldername(name))[1])::uuid));
