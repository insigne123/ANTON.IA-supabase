-- Fase 4: nuevos efectos con revisión humana (profile_update,
-- saved_search_create/update/delete, campaign_stop_v2) y sus propuestas
-- preparadas. Solo amplía vocabulario y añade objetos nuevos; no altera
-- permisos existentes. Cada ejecución relee el estado vigente y rechaza
-- cualquier deriva respecto a lo revisado.
alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2'));

-- The RPC must accept the same vocabulary as the table constraint.
create or replace function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind is null or p_kind not in ('save_contact','start_research','request_draft','enrich_contact',
    'send_email','campaign_create','campaign_activate','campaign_pause','code_execute',
    'profile_update','saved_search_create','saved_search_update','saved_search_delete',
    'campaign_stop_v2') then
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

-- Staged profile update reviewed by the owner. Written once by the worker at
-- propose time (service_role); execution re-reads the profile and refuses on
-- drift. The generic effect machinery owns approve/reject/single-execution.
create table public.cowork_profile_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patch jsonb not null,
  base_updated_at timestamptz not null,
  patch_hash text not null check (length(patch_hash) = 64),
  created_at timestamptz not null default now()
);
alter table public.cowork_profile_proposals enable row level security;
revoke all on public.cowork_profile_proposals from anon, authenticated;
grant select on public.cowork_profile_proposals to authenticated;
grant all on public.cowork_profile_proposals to service_role;
create policy cowork_profile_proposals_private on public.cowork_profile_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));

-- Staged saved-search change reviewed by the owner. op is create, update or
-- delete; search_id is null only for create. Execution re-checks ownership,
-- name conflicts and optimistic concurrency before touching the row.
create table public.cowork_saved_search_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  op text not null check (op in ('create', 'update', 'delete')),
  search_id uuid,
  name text,
  criteria jsonb,
  is_shared boolean not null default false,
  base_updated_at timestamptz,
  proposal_hash text not null check (length(proposal_hash) = 64),
  created_at timestamptz not null default now()
);
alter table public.cowork_saved_search_proposals enable row level security;
revoke all on public.cowork_saved_search_proposals from anon, authenticated;
grant select on public.cowork_saved_search_proposals to authenticated;
grant all on public.cowork_saved_search_proposals to service_role;
create policy cowork_saved_search_proposals_private on public.cowork_saved_search_proposals for select to authenticated
  using (user_id = auth.uid() and public.cowork_has_access(organization_id));
-- Remote migration ledger version: 20260921010035.
