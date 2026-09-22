-- Remote migration ledger version: 20260922050000. Fase 5 (LinkedIn):
-- cola durable de trabajos para la extension (invitaciones y mensajes),
-- snapshot de red, hilos de bandeja y estado de barridos. Solo anade objetos
-- nuevos y amplia el vocabulario de efectos; no altera permisos existentes.
create table public.cowork_linkedin_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.cowork_runs(id) on delete cascade,
  kind text not null check (kind in ('invite', 'message')),
  canonical_url text not null check (length(canonical_url) between 1 and 2048),
  profile_url text not null check (length(profile_url) between 1 and 2048),
  display_name text not null check (length(display_name) between 1 and 300),
  message text check (message is null or length(message) between 1 and 1200),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'confirmed', 'uncertain', 'failed', 'expired')),
  idempotency_key text not null check (length(idempotency_key) = 64),
  claim_token uuid,
  event_id text check (event_id is null or length(event_id) between 1 and 1000),
  thread_url text check (thread_url is null or length(thread_url) between 1 and 2048),
  error text check (error is null or length(error) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, idempotency_key)
);
create index cowork_linkedin_jobs_queue_idx on public.cowork_linkedin_jobs (organization_id, user_id, status, created_at);
alter table public.cowork_linkedin_jobs enable row level security;
revoke all on public.cowork_linkedin_jobs from anon,authenticated;
grant all on public.cowork_linkedin_jobs to service_role;

create table public.cowork_linkedin_job_proposals (
  run_id uuid primary key references public.cowork_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('invite', 'message')),
  lead_id uuid not null,
  canonical_url text not null check (length(canonical_url) between 1 and 2048),
  idempotency_key text not null check (length(idempotency_key) = 64),
  message text check (message is null or length(message) between 1 and 1200),
  message_hash text check (message_hash is null or length(message_hash) = 64),
  proposal_hash text not null check (length(proposal_hash) = 64)
);
alter table public.cowork_linkedin_job_proposals enable row level security;
revoke all on public.cowork_linkedin_job_proposals from anon,authenticated;
grant all on public.cowork_linkedin_job_proposals to service_role;

create table public.cowork_linkedin_peers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_url text not null check (length(canonical_url) between 1 and 2048),
  display_name text not null default '' check (length(display_name) between 0 and 300),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (organization_id, user_id, canonical_url)
);
alter table public.cowork_linkedin_peers enable row level security;
revoke all on public.cowork_linkedin_peers from anon,authenticated;
grant all on public.cowork_linkedin_peers to service_role;

create table public.cowork_linkedin_threads (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_key text not null check (length(thread_key) between 1 and 500),
  canonical_url text check (canonical_url is null or length(canonical_url) between 1 and 2048),
  display_name text not null default '' check (length(display_name) between 0 and 300),
  last_direction text not null default 'in' check (last_direction in ('in', 'out')),
  last_at timestamptz,
  snippet text check (snippet is null or length(snippet) between 1 and 500),
  reply_needed boolean not null default false,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, thread_key)
);
create index cowork_linkedin_threads_attention_idx on public.cowork_linkedin_threads (organization_id, user_id, reply_needed, last_at desc);
alter table public.cowork_linkedin_threads enable row level security;
revoke all on public.cowork_linkedin_threads from anon,authenticated;
grant all on public.cowork_linkedin_threads to service_role;

create table public.cowork_linkedin_sweep_state (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('network', 'inbox')),
  last_completed_at timestamptz,
  cursor text check (cursor is null or length(cursor) between 1 and 500),
  has_more boolean not null default false,
  observed_count integer not null default 0 check (observed_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, kind)
);
alter table public.cowork_linkedin_sweep_state enable row level security;
revoke all on public.cowork_linkedin_sweep_state from anon,authenticated;
grant all on public.cowork_linkedin_sweep_state to service_role;

alter table public.cowork_effect_proposals drop constraint cowork_effect_proposals_kind_check;
alter table public.cowork_effect_proposals add constraint cowork_effect_proposals_kind_check
  check (kind in ('save_contact', 'start_research', 'request_draft', 'enrich_contact',
    'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
    'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete',
    'campaign_stop_v2', 'crm_update_record', 'campaign_prepare_draft_v2',
    'crm_assign_lead', 'exception_resolve', 'mission_control', 'message_context_update',
    'enrich_batch', 'campaign_schedule_batch', 'linkedin_invite', 'linkedin_message'));

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
    'enrich_batch','campaign_schedule_batch','linkedin_invite','linkedin_message') then
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
