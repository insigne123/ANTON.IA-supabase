-- Remote migration ledger version: 20260922030000. Fase 4 (ejecución por correo):
-- programación de lotes con espaciado entre envíos y reserva por empresa y día,
-- más el tipo de efecto campaign_schedule_batch. Solo añade objetos nuevos y
-- amplía el vocabulario de efectos; no altera permisos existentes.
create table public.cowork_send_batch_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.bulk_campaigns(id) on delete cascade,
  campaign_revision integer not null check (campaign_revision > 0),
  spacing_minutes integer not null check (spacing_minutes between 5 and 480),
  proposal_hash text not null check (length(proposal_hash) = 64)
);
create index cowork_send_batch_proposals_campaign_idx on public.cowork_send_batch_proposals (organization_id, campaign_id);
alter table public.cowork_send_batch_proposals enable row level security;
revoke all on public.cowork_send_batch_proposals from anon,authenticated;
grant all on public.cowork_send_batch_proposals to service_role;

create table public.cowork_send_batches (
  campaign_id uuid primary key references public.bulk_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.cowork_runs(id) on delete cascade,
  campaign_revision integer not null check (campaign_revision > 0),
  spacing_minutes integer not null check (spacing_minutes between 5 and 480),
  company_stagger boolean not null default true,
  guards_enabled boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled', 'superseded')),
  proposal_hash text not null check (length(proposal_hash) = 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cowork_send_batches enable row level security;
revoke all on public.cowork_send_batches from anon,authenticated;
grant all on public.cowork_send_batches to service_role;

create table public.cowork_company_send_days (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_key text not null check (length(company_key) between 1 and 300),
  send_day date not null,
  campaign_id uuid not null references public.bulk_campaigns(id) on delete cascade,
  recipient_email text not null check (length(recipient_email) between 3 and 320),
  batch_run_id uuid not null references public.cowork_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, company_key, send_day)
);
create index cowork_company_send_days_campaign_idx on public.cowork_company_send_days (organization_id, campaign_id);
alter table public.cowork_company_send_days enable row level security;
revoke all on public.cowork_company_send_days from anon,authenticated;
grant all on public.cowork_company_send_days to service_role;

alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch'));

-- The RPC must accept the same vocabulary as the table constraint.
create or replace function public.cowork_propose_effect(p_run_id uuid,p_token uuid,p_kind text,
  p_origin_run_id uuid,p_target_id text,p_label text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.cowork_runs;
begin
  if p_kind is null or p_kind not in ('save_contact','start_research','request_draft','enrich_contact',
    'send_email','campaign_create','campaign_activate','campaign_pause','code_execute',
    'profile_update','saved_search_create','saved_search_update','saved_search_delete',
    'campaign_stop_v2','crm_update_record','campaign_prepare_draft_v2',
    'crm_assign_lead','exception_resolve','mission_control','message_context_update',
    'enrich_batch','campaign_schedule_batch') then
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
