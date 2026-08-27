-- Organization collaboration v1: active team data, durable lead attribution,
-- secure invitations, and an atomic one-active-thread outbound boundary.

alter table public.organizations
  add column if not exists collaboration_v1_enabled boolean not null default false;

-- Invitations retain their audit row, but never persist or list the bearer token.
alter table public.organization_invites
  alter column token drop not null,
  add column if not exists token_hash text,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

update public.organization_invites
set token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
where token_hash is null and nullif(trim(token), '') is not null;

update public.organization_invites set token = null where token is not null;

alter table public.organization_invites
  alter column token_hash set not null,
  drop constraint if exists organization_invites_role_check,
  add constraint organization_invites_role_check check (role in ('admin', 'member')),
  drop constraint if exists organization_invites_email_organization_id_key,
  add constraint organization_invites_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  add constraint organization_invites_state_check check (
    not (accepted_at is not null and revoked_at is not null)
  );

create unique index if not exists organization_invites_token_hash_uidx
  on public.organization_invites(token_hash);
create unique index if not exists organization_invites_active_email_uidx
  on public.organization_invites(organization_id, lower(trim(email)))
  where accepted_at is null and revoked_at is null;
create index if not exists organization_invites_pending_idx
  on public.organization_invites(organization_id, expires_at)
  where accepted_at is null and revoked_at is null;

create table if not exists public.organization_collaboration_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id text,
  lead_id uuid references public.leads(id) on delete set null,
  contact_thread_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint organization_collaboration_events_type_check check (length(trim(event_type)) between 1 and 120),
  constraint organization_collaboration_events_entity_check check (length(trim(entity_type)) between 1 and 80),
  constraint organization_collaboration_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists organization_collaboration_events_org_created_idx
  on public.organization_collaboration_events(organization_id, created_at desc);
create index if not exists organization_collaboration_events_lead_created_idx
  on public.organization_collaboration_events(lead_id, created_at desc)
  where lead_id is not null;

create table if not exists public.organization_lead_collaboration (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  discovered_by_user_id uuid references auth.users(id) on delete set null,
  discovered_at timestamptz not null default now(),
  assigned_to_user_id uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by_user_id uuid references auth.users(id) on delete set null,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claim_expires_at timestamptz,
  contact_state text not null default 'uncontacted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_lead_collaboration_contact_state_check check (
    contact_state in ('uncontacted', 'reserved', 'contacted', 'replied', 'suppressed')
  ),
  constraint organization_lead_collaboration_assignment_check check (
    (assigned_to_user_id is null and assigned_at is null)
    or (assigned_to_user_id is not null and assigned_at is not null)
  ),
  constraint organization_lead_collaboration_claim_check check (
    (claimed_by_user_id is null and claim_expires_at is null)
    or (claimed_by_user_id is not null and claim_expires_at is not null)
  )
);

create index if not exists organization_lead_collaboration_org_assignee_idx
  on public.organization_lead_collaboration(organization_id, assigned_to_user_id, updated_at desc);
create index if not exists organization_lead_collaboration_active_claim_idx
  on public.organization_lead_collaboration(organization_id, claim_expires_at)
  where claimed_by_user_id is not null;

create table if not exists public.organization_contact_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  recipient_key text not null,
  recipient_email text,
  status text not null default 'available',
  active_lead_id uuid references public.leads(id) on delete set null,
  active_campaign_id text,
  opened_by_user_id uuid references auth.users(id) on delete set null,
  last_sent_by_user_id uuid references auth.users(id) on delete set null,
  root_dispatch_id uuid,
  reserved_dispatch_id uuid,
  reservation_expires_at timestamptz,
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  closed_at timestamptz,
  reopened_at timestamptz,
  reopened_by_user_id uuid references auth.users(id) on delete set null,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_contact_threads_channel_check check (channel in ('email', 'linkedin')),
  constraint organization_contact_threads_recipient_key_check check (length(trim(recipient_key)) between 3 and 500),
  constraint organization_contact_threads_status_check check (status in ('available', 'reserved', 'active', 'closed', 'suppressed')),
  constraint organization_contact_threads_email_check check (
    channel <> 'email' or (
      recipient_email is not null
      and recipient_email = lower(trim(recipient_email))
      and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and recipient_key = recipient_email
    )
  ),
  constraint organization_contact_threads_reservation_check check (
    (reserved_dispatch_id is null and reservation_expires_at is null)
    or (reserved_dispatch_id is not null and reservation_expires_at is not null)
  ),
  constraint organization_contact_threads_reopen_check check (
    (reopened_at is null and reopened_by_user_id is null and reopen_reason is null)
    or (reopened_at is not null and reopened_by_user_id is not null and length(trim(reopen_reason)) between 3 and 1000)
  ),
  unique (organization_id, channel, recipient_key)
);

create index if not exists organization_contact_threads_org_status_idx
  on public.organization_contact_threads(organization_id, status, last_contacted_at desc);
create index if not exists organization_contact_threads_reserved_idx
  on public.organization_contact_threads(reservation_expires_at)
  where reserved_dispatch_id is not null;

alter table public.outbound_dispatches
  add column if not exists contact_thread_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_dispatches_contact_thread_fkey'
      and conrelid = 'public.outbound_dispatches'::regclass
  ) then
    alter table public.outbound_dispatches
      add constraint outbound_dispatches_contact_thread_fkey
      foreign key (contact_thread_id) references public.organization_contact_threads(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_contact_threads_root_dispatch_fkey'
      and conrelid = 'public.organization_contact_threads'::regclass
  ) then
    alter table public.organization_contact_threads
      add constraint organization_contact_threads_root_dispatch_fkey
      foreign key (root_dispatch_id) references public.outbound_dispatches(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_contact_threads_reserved_dispatch_fkey'
      and conrelid = 'public.organization_contact_threads'::regclass
  ) then
    alter table public.organization_contact_threads
      add constraint organization_contact_threads_reserved_dispatch_fkey
      foreign key (reserved_dispatch_id) references public.outbound_dispatches(id) on delete set null;
  end if;
end;
$$;

alter table public.organization_collaboration_events
  drop constraint if exists organization_collaboration_events_contact_thread_fkey;
alter table public.organization_collaboration_events
  add constraint organization_collaboration_events_contact_thread_fkey
  foreign key (contact_thread_id) references public.organization_contact_threads(id) on delete set null;

-- Seed the recipient boundary from confirmed historical sends before any
-- organization is opted into enforcement. The first send owns the thread;
-- the most recent send provides its current activity timestamp.
with normalized_dispatches as (
  select
    od.id,
    od.organization_id,
    od.user_id,
    lower(trim(od.metadata #>> '{recipient,email}')) as recipient_email,
    case
      when od.metadata #>> '{recipient,leadRef}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (od.metadata #>> '{recipient,leadRef}')::uuid
      else null
    end as lead_id,
    case
      when crs.id is not null then crs.campaign_id::text
      when od.idempotency_key ~* '^campaign:[^:]+:' then split_part(od.idempotency_key, ':', 2)
      else null
    end as campaign_id,
    coalesce(od.completed_at, od.updated_at, od.created_at) as contacted_at
  from public.outbound_dispatches od
  left join public.campaign_recipient_steps crs
    on crs.id = od.campaign_recipient_step_id
   and crs.organization_id = od.organization_id
  where od.status = 'sent'
    and od.channel = 'email'
    and lower(trim(coalesce(od.metadata #>> '{recipient,email}', '')))
      ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
), roots as (
  select distinct on (organization_id, recipient_email) *
  from normalized_dispatches
  order by organization_id, recipient_email, contacted_at, id
), latest as (
  select distinct on (organization_id, recipient_email) *
  from normalized_dispatches
  order by organization_id, recipient_email, contacted_at desc, id desc
)
insert into public.organization_contact_threads (
  organization_id, channel, recipient_key, recipient_email, status,
  active_lead_id, active_campaign_id, opened_by_user_id, last_sent_by_user_id,
  root_dispatch_id, first_contacted_at, last_contacted_at, created_at, updated_at
)
select
  roots.organization_id, 'email', roots.recipient_email, roots.recipient_email, 'active',
  roots.lead_id, roots.campaign_id, roots.user_id, latest.user_id,
  roots.id, roots.contacted_at, latest.contacted_at, roots.contacted_at, latest.contacted_at
from roots
join latest using (organization_id, recipient_email)
on conflict (organization_id, channel, recipient_key) do nothing;

-- Dropping the guard takes an ACCESS EXCLUSIVE lock until commit, so the
-- historical link can be populated without opening a concurrent write window.
drop trigger if exists outbound_dispatches_transition_guard on public.outbound_dispatches;
update public.outbound_dispatches od
set contact_thread_id = oct.id
from public.organization_contact_threads oct
where od.contact_thread_id is null
  and od.status = 'sent'
  and od.channel = 'email'
  and oct.organization_id = od.organization_id
  and oct.channel = 'email'
  and oct.recipient_key = lower(trim(od.metadata #>> '{recipient,email}'));
create trigger outbound_dispatches_transition_guard
  before insert or update or delete on public.outbound_dispatches
  for each row execute function public.enforce_outbound_dispatch_transition();

create or replace function public.organization_has_role_v1(
  p_organization_id uuid,
  p_roles text[] default array['owner', 'admin', 'member']::text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.role = any(p_roles)
  );
$$;

revoke all on function public.organization_has_role_v1(uuid, text[]) from public;
grant execute on function public.organization_has_role_v1(uuid, text[]) to authenticated, service_role;

create or replace function public.append_organization_collaboration_event_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id text default null,
  p_lead_id uuid default null,
  p_contact_thread_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null
    or length(trim(coalesce(p_event_type, ''))) not between 1 and 120
    or length(trim(coalesce(p_entity_type, ''))) not between 1 and 80
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid collaboration event' using errcode = '22023';
  end if;

  insert into public.organization_collaboration_events (
    organization_id, actor_user_id, event_type, entity_type, entity_id,
    lead_id, contact_thread_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, trim(p_event_type), trim(p_entity_type),
    nullif(trim(coalesce(p_entity_id, '')), ''), p_lead_id, p_contact_thread_id,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.append_organization_collaboration_event_v1(uuid, uuid, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.append_organization_collaboration_event_v1(uuid, uuid, text, text, text, uuid, uuid, jsonb) to service_role;

create or replace function public.block_organization_collaboration_event_mutation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'organization collaboration events are append-only' using errcode = '55000';
end;
$$;

drop trigger if exists organization_collaboration_events_immutable on public.organization_collaboration_events;
create trigger organization_collaboration_events_immutable
  before update or delete on public.organization_collaboration_events
  for each row execute function public.block_organization_collaboration_event_mutation_v1();

create or replace function public.ensure_organization_lead_collaboration_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then return new; end if;

  insert into public.organization_lead_collaboration (
    lead_id, organization_id, discovered_by_user_id, discovered_at
  ) values (
    new.id, new.organization_id, new.user_id, coalesce(new.created_at, now())
  ) on conflict (lead_id) do nothing;

  if tg_op = 'INSERT' then
    perform public.append_organization_collaboration_event_v1(
      new.organization_id, new.user_id, 'lead.discovered', 'lead', new.id::text,
      new.id, null, '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_organization_lead_collaboration on public.leads;
create trigger ensure_organization_lead_collaboration
  after insert or update of organization_id on public.leads
  for each row execute function public.ensure_organization_lead_collaboration_v1();

insert into public.organization_lead_collaboration (
  lead_id, organization_id, discovered_by_user_id, discovered_at
)
select l.id, l.organization_id, l.user_id, coalesce(l.created_at, now())
from public.leads l
where l.organization_id is not null
on conflict (lead_id) do nothing;

create or replace function public.guard_organization_lead_collaboration_identity_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lead_id is distinct from old.lead_id
    or new.organization_id is distinct from old.organization_id
    or new.discovered_by_user_id is distinct from old.discovered_by_user_id
    or new.discovered_at is distinct from old.discovered_at
    or new.created_at is distinct from old.created_at then
    raise exception 'lead collaboration provenance is immutable' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_organization_lead_collaboration_identity on public.organization_lead_collaboration;
create trigger guard_organization_lead_collaboration_identity
  before update on public.organization_lead_collaboration
  for each row execute function public.guard_organization_lead_collaboration_identity_v1();

create or replace function public.assign_organization_lead_v1(
  p_lead_id uuid,
  p_assigned_to_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_lead_collaboration%rowtype;
  v_actor_role text;
begin
  if auth.uid() is null or p_lead_id is null or p_assigned_to_user_id is null then
    raise exception 'invalid lead assignment' using errcode = '22023';
  end if;

  select * into v_row
  from public.organization_lead_collaboration
  where lead_id = p_lead_id
  for update;
  if not found then raise exception 'Lead collaboration row not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_row.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;

  select om.role into v_actor_role
  from public.organization_members om
  where om.organization_id = v_row.organization_id and om.user_id = auth.uid();
  if v_actor_role is null then raise exception 'not authorized' using errcode = '42501'; end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_row.organization_id and om.user_id = p_assigned_to_user_id
  ) then
    raise exception 'Assignee is not an organization member' using errcode = '22023';
  end if;

  if v_actor_role = 'member' and (
    p_assigned_to_user_id <> auth.uid()
    or (v_row.assigned_to_user_id is not null and v_row.assigned_to_user_id <> auth.uid())
  ) then
    raise exception 'Members can only claim an unassigned lead for themselves' using errcode = '42501';
  end if;

  update public.organization_lead_collaboration
  set assigned_to_user_id = p_assigned_to_user_id,
      assigned_at = now(),
      assigned_by_user_id = auth.uid(),
      claimed_by_user_id = case
        when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id then null
        else claimed_by_user_id
      end,
      claim_expires_at = case
        when claimed_by_user_id is not null and claimed_by_user_id is distinct from p_assigned_to_user_id then null
        else claim_expires_at
      end,
      contact_state = case
        when claimed_by_user_id is not null
          and claimed_by_user_id is distinct from p_assigned_to_user_id
          and contact_state = 'reserved' then 'uncontacted'
        else contact_state
      end
  where lead_id = p_lead_id
  returning * into v_row;

  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, auth.uid(), 'lead.assigned', 'lead', p_lead_id::text,
    p_lead_id, null, jsonb_build_object('assignedToUserId', p_assigned_to_user_id)
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.claim_organization_lead_v1(
  p_lead_id uuid,
  p_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_lead_collaboration%rowtype;
  v_actor_role text;
begin
  if auth.uid() is null or p_lead_id is null or p_minutes not between 1 and 60 then
    raise exception 'invalid lead claim' using errcode = '22023';
  end if;

  select * into v_row
  from public.organization_lead_collaboration
  where lead_id = p_lead_id
  for update;
  if not found then raise exception 'Lead collaboration row not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_row.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;

  select om.role into v_actor_role
  from public.organization_members om
  where om.organization_id = v_row.organization_id and om.user_id = auth.uid();
  if v_actor_role is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_row.claimed_by_user_id is not null
    and v_row.claimed_by_user_id <> auth.uid()
    and v_row.claim_expires_at > now() then
    raise exception 'Lead is already being prepared by another member' using errcode = '55000';
  end if;
  if v_actor_role = 'member' and v_row.assigned_to_user_id is not null
    and v_row.assigned_to_user_id <> auth.uid() then
    raise exception 'Lead is assigned to another member' using errcode = '42501';
  end if;

  update public.organization_lead_collaboration
  set assigned_to_user_id = coalesce(assigned_to_user_id, auth.uid()),
      assigned_at = case when assigned_to_user_id is null then now() else assigned_at end,
      assigned_by_user_id = case when assigned_to_user_id is null then auth.uid() else assigned_by_user_id end,
      claimed_by_user_id = auth.uid(),
      claim_expires_at = now() + make_interval(mins => p_minutes),
      contact_state = case when contact_state = 'uncontacted' then 'reserved' else contact_state end
  where lead_id = p_lead_id
  returning * into v_row;

  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, auth.uid(), 'lead.claimed', 'lead', p_lead_id::text,
    p_lead_id, null, jsonb_build_object('expiresAt', v_row.claim_expires_at)
  );
  return to_jsonb(v_row);
end;
$$;

create or replace function public.release_organization_lead_claim_v1(p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.organization_lead_collaboration%rowtype;
  v_role text;
begin
  select * into v_row
  from public.organization_lead_collaboration
  where lead_id = p_lead_id
  for update;
  if not found then return false; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_row.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;

  select om.role into v_role from public.organization_members om
  where om.organization_id = v_row.organization_id and om.user_id = auth.uid();
  if v_role is null or (
    v_row.claimed_by_user_id is distinct from auth.uid() and v_role not in ('owner', 'admin')
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.organization_lead_collaboration
  set claimed_by_user_id = null,
      claim_expires_at = null,
      contact_state = case when contact_state = 'reserved' then 'uncontacted' else contact_state end
  where lead_id = p_lead_id;
  perform public.append_organization_collaboration_event_v1(
    v_row.organization_id, auth.uid(), 'lead.claim_released', 'lead', p_lead_id::text,
    p_lead_id, null, '{}'::jsonb
  );
  return true;
end;
$$;

revoke all on function public.assign_organization_lead_v1(uuid, uuid) from public, anon;
revoke all on function public.claim_organization_lead_v1(uuid, integer) from public, anon;
revoke all on function public.release_organization_lead_claim_v1(uuid) from public, anon;
grant execute on function public.assign_organization_lead_v1(uuid, uuid) to authenticated, service_role;
grant execute on function public.claim_organization_lead_v1(uuid, integer) to authenticated, service_role;
grant execute on function public.release_organization_lead_claim_v1(uuid) to authenticated, service_role;

-- Membership and invitation mutations are server-owned RPCs. Direct table DML
-- is removed so a client cannot forge a role or membership row.
create or replace function public.create_organization_invite_v1(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_invite public.organization_invites%rowtype;
begin
  if not public.organization_has_role_v1(p_organization_id, array['owner', 'admin']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role not in ('admin', 'member')
    or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid invitation' using errcode = '22023';
  end if;
  if exists (
    select 1 from auth.users u
    join public.organization_members om on om.user_id = u.id
    where om.organization_id = p_organization_id and lower(trim(u.email)) = v_email
  ) then
    raise exception 'This person is already a member' using errcode = '23505';
  end if;

  update public.organization_invites
  set revoked_at = now(), revoked_by = auth.uid()
  where organization_id = p_organization_id
    and lower(trim(email)) = v_email
    and accepted_at is null and revoked_at is null;

  insert into public.organization_invites (
    organization_id, email, role, token, token_hash, invited_by, expires_at
  ) values (
    p_organization_id, v_email, p_role, null, p_token_hash, auth.uid(), now() + interval '7 days'
  ) returning * into v_invite;

  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.invited', 'organization_invite', v_invite.id::text,
    null, null, jsonb_build_object('role', p_role)
  );
  return jsonb_build_object(
    'id', v_invite.id,
    'email', v_invite.email,
    'role', v_invite.role,
    'expiresAt', v_invite.expires_at
  );
end;
$$;

create or replace function public.accept_organization_invite_v1(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.organization_invites%rowtype;
  v_user_email text;
begin
  if auth.uid() is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid invitation' using errcode = '22023';
  end if;

  select * into v_invite
  from public.organization_invites
  where token_hash = p_token_hash
  for update;
  if not found or v_invite.revoked_at is not null or v_invite.accepted_at is not null
    or v_invite.expires_at <= now() then
    raise exception 'Invitation is invalid or expired' using errcode = '55000';
  end if;

  select lower(trim(u.email)) into v_user_email from auth.users u where u.id = auth.uid();
  if v_user_email is distinct from lower(trim(v_invite.email)) then
    raise exception 'Invitation belongs to another email address' using errcode = '42501';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invite.id;

  perform public.append_organization_collaboration_event_v1(
    v_invite.organization_id, auth.uid(), 'member.joined', 'organization_member', auth.uid()::text,
    null, null, jsonb_build_object('role', v_invite.role)
  );
  return v_invite.organization_id;
end;
$$;

create or replace function public.revoke_organization_invite_v1(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.organization_invites%rowtype;
begin
  select * into v_invite from public.organization_invites where id = p_invite_id for update;
  if not found then return false; end if;
  if not public.organization_has_role_v1(v_invite.organization_id, array['owner', 'admin']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'Accepted invitations cannot be revoked' using errcode = '55000';
  end if;
  update public.organization_invites
  set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, auth.uid())
  where id = p_invite_id;
  perform public.append_organization_collaboration_event_v1(
    v_invite.organization_id, auth.uid(), 'member.invite_revoked', 'organization_invite', p_invite_id::text
  );
  return true;
end;
$$;

create or replace function public.update_organization_member_role_v1(
  p_organization_id uuid,
  p_user_id uuid,
  p_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(concat('organization-membership:', p_organization_id::text), 0));
  select role into v_actor_role from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();
  select role into v_target_role from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_actor_role not in ('owner', 'admin') or v_target_role is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if v_actor_role = 'admin' and (v_target_role = 'owner' or p_role = 'owner') then
    raise exception 'Admins cannot manage owners' using errcode = '42501';
  end if;
  if v_target_role = 'owner' and p_role <> 'owner' and (
    select count(*) from public.organization_members
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 then
    raise exception 'Organization must keep at least one owner' using errcode = '55000';
  end if;

  update public.organization_members set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;
  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.role_changed', 'organization_member', p_user_id::text,
    null, null, jsonb_build_object('previousRole', v_target_role, 'role', p_role)
  );
  return true;
end;
$$;

create or replace function public.remove_organization_member_v1(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_target_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(concat('organization-membership:', p_organization_id::text), 0));
  if p_user_id = auth.uid() then
    raise exception 'Use leave organization for your own membership' using errcode = '22023';
  end if;
  select role into v_actor_role from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();
  select role into v_target_role from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id for update;
  if v_actor_role not in ('owner', 'admin') or v_target_role is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_actor_role = 'admin' and v_target_role = 'owner' then
    raise exception 'Admins cannot remove owners' using errcode = '42501';
  end if;
  if v_target_role = 'owner' and (
    select count(*) from public.organization_members
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 then
    raise exception 'Organization must keep at least one owner' using errcode = '55000';
  end if;

  delete from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;
  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.removed', 'organization_member', p_user_id::text,
    null, null, jsonb_build_object('previousRole', v_target_role)
  );
  return true;
end;
$$;

create or replace function public.leave_organization_v1(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(concat('organization-membership:', p_organization_id::text), 0));
  select role into v_role from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid() for update;
  if v_role is null then return false; end if;
  if v_role = 'owner' and (
    select count(*) from public.organization_members
    where organization_id = p_organization_id and role = 'owner'
  ) <= 1 then
    raise exception 'Transfer ownership before leaving' using errcode = '55000';
  end if;
  delete from public.organization_members
  where organization_id = p_organization_id and user_id = auth.uid();
  perform public.append_organization_collaboration_event_v1(
    p_organization_id, auth.uid(), 'member.left', 'organization_member', auth.uid()::text,
    null, null, jsonb_build_object('previousRole', v_role)
  );
  return true;
end;
$$;

revoke all on function public.create_organization_invite_v1(uuid, text, text, text) from public, anon;
revoke all on function public.accept_organization_invite_v1(text) from public, anon;
revoke all on function public.revoke_organization_invite_v1(uuid) from public, anon;
revoke all on function public.update_organization_member_role_v1(uuid, uuid, text) from public, anon;
revoke all on function public.remove_organization_member_v1(uuid, uuid) from public, anon;
revoke all on function public.leave_organization_v1(uuid) from public, anon;
grant execute on function public.create_organization_invite_v1(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.accept_organization_invite_v1(text) to authenticated, service_role;
grant execute on function public.revoke_organization_invite_v1(uuid) to authenticated, service_role;
grant execute on function public.update_organization_member_role_v1(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.remove_organization_member_v1(uuid, uuid) to authenticated, service_role;
grant execute on function public.leave_organization_v1(uuid) to authenticated, service_role;

-- Collaboration-enabled organizations retain organization-owned records after a
-- membership is removed. Historical provenance remains, while RLS removes access.
create or replace function public.unlink_member_owned_records_from_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collaboration_enabled boolean := false;
begin
  select coalesce(o.collaboration_v1_enabled, false) into v_collaboration_enabled
  from public.organizations o where o.id = old.organization_id;
  if v_collaboration_enabled then return old; end if;

  update public.leads set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  update public.enriched_leads set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  update public.contacted_leads set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  update public.campaigns set organization_id = null
  where organization_id = old.organization_id and user_id = old.user_id;
  return old;
end;
$$;

-- One active recipient thread is claimed in the same transaction that marks a
-- dispatch sending. Conflicts become a known pre-provider rejection.
create or replace function public.claim_outbound_dispatch_sending_v2(
  p_dispatch_id uuid,
  p_started_at timestamptz,
  p_expected_attempt_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.outbound_dispatches%rowtype;
  v_thread public.organization_contact_threads%rowtype;
  v_recipient_email text;
  v_lead_ref text;
  v_lead_id uuid;
  v_campaign_id text;
  v_feature_enabled boolean := false;
  v_conflict text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_started_at is null or p_expected_attempt_count is null
    or p_expected_attempt_count < 0 then
    raise exception 'invalid outbound dispatch sending claim' using errcode = '22023';
  end if;

  select od.* into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
  for update;
  if not found then raise exception 'Outbound dispatch was not found' using errcode = 'P0002'; end if;

  if v_dispatch.status not in ('pending', 'deferred')
    or v_dispatch.attempt_count <> p_expected_attempt_count then
    return jsonb_build_object('claimed', false, 'dispatch', to_jsonb(v_dispatch));
  end if;

  select lower(trim(coalesce(
    nullif(v_dispatch.metadata #>> '{recipient,email}', ''),
    nullif(mdv.recipient ->> 'email', '')
  ))), trim(coalesce(
    nullif(v_dispatch.metadata #>> '{recipient,leadRef}', ''),
    nullif(mdv.recipient ->> 'leadRef', ''),
    ''
  ))
  into v_recipient_email, v_lead_ref
  from public.messaging_draft_versions mdv
  where mdv.id = v_dispatch.version_id and mdv.draft_id = v_dispatch.draft_id;

  if v_recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_recipient_email), 0));
  end if;

  select coalesce(o.collaboration_v1_enabled, false) into v_feature_enabled
  from public.organizations o where o.id = v_dispatch.organization_id;

  if v_feature_enabled and v_dispatch.channel = 'email' then
    if v_recipient_email is null
      or v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Outbound email dispatch has no valid recipient' using errcode = '23514';
    end if;

    if v_lead_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_lead_id := v_lead_ref::uuid;
    end if;
    if v_dispatch.campaign_recipient_step_id is not null then
      select crs.campaign_id::text into v_campaign_id
      from public.campaign_recipient_steps crs
      where crs.id = v_dispatch.campaign_recipient_step_id
        and crs.organization_id = v_dispatch.organization_id;
    elsif v_dispatch.idempotency_key ~* '^campaign:[^:]+:' then
      v_campaign_id := split_part(v_dispatch.idempotency_key, ':', 2);
    end if;

    perform pg_advisory_xact_lock(hashtextextended(concat(
      'organization-contact:', v_dispatch.organization_id::text, ':email:', v_recipient_email
    ), 0));

    select * into v_thread
    from public.organization_contact_threads oct
    where oct.organization_id = v_dispatch.organization_id
      and oct.channel = 'email'
      and oct.recipient_key = v_recipient_email
    for update;

    if not found then
      insert into public.organization_contact_threads (
        organization_id, channel, recipient_key, recipient_email, status,
        active_lead_id, active_campaign_id, opened_by_user_id,
        reserved_dispatch_id, reservation_expires_at
      ) values (
        v_dispatch.organization_id, 'email', v_recipient_email, v_recipient_email, 'reserved',
        v_lead_id, v_campaign_id, v_dispatch.user_id,
        v_dispatch.id, p_started_at + interval '30 minutes'
      ) returning * into v_thread;
    else
      if v_thread.reserved_dispatch_id is not null
        and v_thread.reserved_dispatch_id <> v_dispatch.id then
        v_conflict := 'Another member is already preparing contact for this recipient.';
      elsif v_thread.status = 'suppressed' then
        v_conflict := 'This recipient is suppressed for the organization.';
      elsif v_thread.status = 'closed' then
        v_conflict := 'This recipient thread must be reopened by an admin.';
      elsif v_thread.status = 'active' then
        if v_thread.opened_by_user_id is distinct from v_dispatch.user_id then
          v_conflict := 'This recipient already has an active thread owned by another member.';
        elsif v_thread.active_campaign_id is not null
          and v_thread.active_campaign_id is distinct from v_campaign_id then
          v_conflict := 'This recipient already belongs to another active campaign thread.';
        elsif v_thread.active_campaign_id is null
          and v_campaign_id is null
          and (v_thread.active_lead_id is null or v_thread.active_lead_id is distinct from v_lead_id) then
          v_conflict := 'This recipient already has an active commercial thread.';
        elsif v_thread.active_campaign_id is null
          and v_campaign_id is not null then
          v_conflict := 'A new campaign cannot replace this recipient active thread.';
        end if;
      end if;

      if v_conflict is null then
        update public.organization_contact_threads
        set status = case when status = 'available' then 'reserved' else status end,
            active_lead_id = coalesce(active_lead_id, v_lead_id),
            active_campaign_id = coalesce(active_campaign_id, v_campaign_id),
            opened_by_user_id = coalesce(opened_by_user_id, v_dispatch.user_id),
            reserved_dispatch_id = v_dispatch.id,
            reservation_expires_at = p_started_at + interval '30 minutes',
            updated_at = p_started_at
        where id = v_thread.id
        returning * into v_thread;
      end if;
    end if;

    if v_conflict is not null then
      update public.outbound_dispatches
      set status = 'failed',
          started_at = null,
          completed_at = p_started_at,
          provider_message_id = null,
          provider_response = jsonb_build_object(
            'providerInvoked', false,
            'databaseCode', 'recipient_thread_conflict',
            'reason', v_conflict,
            'contactThreadId', v_thread.id
          ),
          error_code = 'pre_provider_rejected',
          error_message = v_conflict,
          contact_thread_id = v_thread.id,
          updated_at = p_started_at
      where id = p_dispatch_id
        and status in ('pending', 'deferred')
        and attempt_count = p_expected_attempt_count
      returning * into v_dispatch;

      perform public.append_organization_collaboration_event_v1(
        v_dispatch.organization_id, v_dispatch.user_id, 'contact.blocked', 'outbound_dispatch',
        v_dispatch.id::text, v_lead_id, v_thread.id,
        jsonb_build_object('reason', v_conflict)
      );
      return jsonb_build_object('claimed', false, 'dispatch', to_jsonb(v_dispatch));
    end if;
  end if;

  update public.outbound_dispatches
  set status = 'sending',
      started_at = p_started_at,
      completed_at = null,
      provider_message_id = null,
      provider_response = null,
      error_code = null,
      error_message = null,
      contact_thread_id = case when v_feature_enabled and channel = 'email' then v_thread.id else contact_thread_id end,
      updated_at = p_started_at,
      attempt_count = p_expected_attempt_count + 1
  where id = p_dispatch_id
    and status in ('pending', 'deferred')
    and attempt_count = p_expected_attempt_count
  returning * into v_dispatch;
  if not found then
    select * into v_dispatch from public.outbound_dispatches where id = p_dispatch_id;
    return jsonb_build_object('claimed', false, 'dispatch', to_jsonb(v_dispatch));
  end if;

  if v_dispatch.contact_thread_id is not null then
    perform public.append_organization_collaboration_event_v1(
      v_dispatch.organization_id, v_dispatch.user_id, 'contact.reserved', 'outbound_dispatch',
      v_dispatch.id::text, v_lead_id, v_dispatch.contact_thread_id, '{}'::jsonb
    );
  end if;
  return jsonb_build_object('claimed', true, 'dispatch', to_jsonb(v_dispatch));
end;
$$;

create or replace function public.project_organization_contact_thread_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.organization_contact_threads%rowtype;
  v_lead_id uuid;
begin
  if new.contact_thread_id is null or old.status is not distinct from new.status then return new; end if;
  select * into v_thread from public.organization_contact_threads
  where id = new.contact_thread_id for update;
  if not found then return new; end if;

  if new.metadata #>> '{recipient,leadRef}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_lead_id := (new.metadata #>> '{recipient,leadRef}')::uuid;
  end if;

  if new.status = 'sent' then
    update public.organization_contact_threads
    set status = 'active',
        root_dispatch_id = coalesce(root_dispatch_id, new.id),
        reserved_dispatch_id = null,
        reservation_expires_at = null,
        active_lead_id = coalesce(active_lead_id, v_lead_id),
        opened_by_user_id = coalesce(opened_by_user_id, new.user_id),
        last_sent_by_user_id = new.user_id,
        first_contacted_at = coalesce(first_contacted_at, new.completed_at, now()),
        last_contacted_at = greatest(coalesce(last_contacted_at, new.completed_at, now()), coalesce(new.completed_at, now())),
        updated_at = coalesce(new.completed_at, now())
    where id = new.contact_thread_id;

    if v_lead_id is not null then
      update public.organization_lead_collaboration
      set contact_state = 'contacted', claimed_by_user_id = null, claim_expires_at = null
      where lead_id = v_lead_id and organization_id = new.organization_id;
    end if;
    perform public.append_organization_collaboration_event_v1(
      new.organization_id, new.user_id, 'contact.sent', 'outbound_dispatch', new.id::text,
      v_lead_id, new.contact_thread_id, jsonb_build_object('provider', new.provider)
    );
  elsif new.status in ('failed', 'deferred') and v_thread.reserved_dispatch_id = new.id then
    update public.organization_contact_threads
    set status = case when root_dispatch_id is null then 'available' else status end,
        reserved_dispatch_id = null,
        reservation_expires_at = null,
        updated_at = coalesce(new.completed_at, now())
    where id = new.contact_thread_id;
    perform public.append_organization_collaboration_event_v1(
      new.organization_id, new.user_id, 'contact.released', 'outbound_dispatch', new.id::text,
      v_lead_id, new.contact_thread_id, jsonb_build_object('dispatchStatus', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists outbound_dispatches_project_organization_thread on public.outbound_dispatches;
create trigger outbound_dispatches_project_organization_thread
  after update of status on public.outbound_dispatches
  for each row execute function public.project_organization_contact_thread_v1();

create or replace function public.reopen_organization_contact_thread_v1(
  p_contact_thread_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.organization_contact_threads%rowtype;
  v_previous_root uuid;
begin
  select * into v_thread from public.organization_contact_threads
  where id = p_contact_thread_id for update;
  if not found then raise exception 'Contact thread not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = v_thread.organization_id and o.collaboration_v1_enabled
  ) then
    raise exception 'Organization collaboration is not enabled' using errcode = '55000';
  end if;
  if not public.organization_has_role_v1(v_thread.organization_id, array['owner', 'admin']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'Reopen reason is required' using errcode = '22023';
  end if;
  if v_thread.last_contacted_at is null or v_thread.last_contacted_at > now() - interval '90 days' then
    raise exception 'Contact thread cannot be reopened before 90 days' using errcode = '55000';
  end if;
  if v_thread.reserved_dispatch_id is not null then
    raise exception 'Contact thread has an in-flight dispatch' using errcode = '55000';
  end if;

  v_previous_root := v_thread.root_dispatch_id;
  update public.organization_contact_threads
  set status = 'available',
      active_lead_id = null,
      active_campaign_id = null,
      opened_by_user_id = null,
      root_dispatch_id = null,
      closed_at = now(),
      reopened_at = now(),
      reopened_by_user_id = auth.uid(),
      reopen_reason = trim(p_reason),
      updated_at = now()
  where id = p_contact_thread_id
  returning * into v_thread;

  perform public.append_organization_collaboration_event_v1(
    v_thread.organization_id, auth.uid(), 'contact.reopened', 'contact_thread', v_thread.id::text,
    null, v_thread.id, jsonb_build_object('reason', trim(p_reason), 'previousRootDispatchId', v_previous_root)
  );
  return to_jsonb(v_thread);
end;
$$;

revoke all on function public.reopen_organization_contact_thread_v1(uuid, text) from public, anon;
grant execute on function public.reopen_organization_contact_thread_v1(uuid, text) to authenticated, service_role;

-- The legacy plaintext-token acceptor cannot accept v1 hashed invitations.
revoke all on function public.accept_invite(text) from public, anon, authenticated;

create or replace function public.organization_collaboration_rollout_report_v1(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  with confirmed as (
    select
      lower(trim(od.metadata #>> '{recipient,email}')) as recipient_email,
      od.user_id,
      nullif(trim(od.metadata #>> '{recipient,leadRef}'), '') as lead_ref,
      case
        when crs.id is not null then crs.campaign_id::text
        when od.idempotency_key ~* '^campaign:[^:]+:' then split_part(od.idempotency_key, ':', 2)
        else null
      end as campaign_id,
      case
        when crs.id is not null then concat('campaign:', crs.campaign_id::text)
        when od.idempotency_key ~* '^campaign:[^:]+:' then concat('campaign:', split_part(od.idempotency_key, ':', 2))
        else concat('lead:', coalesce(nullif(trim(od.metadata #>> '{recipient,leadRef}'), ''), 'unknown'))
      end as origin_key
    from public.outbound_dispatches od
    left join public.campaign_recipient_steps crs
      on crs.id = od.campaign_recipient_step_id
     and crs.organization_id = od.organization_id
    where od.organization_id = p_organization_id
      and od.channel = 'email'
      and od.status = 'sent'
      and lower(trim(coalesce(od.metadata #>> '{recipient,email}', '')))
        ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ), recipient_summary as (
    select
      recipient_email,
      count(*) as send_count,
      count(distinct user_id) as sender_count,
      count(distinct lead_ref) as lead_count,
      count(distinct campaign_id) as campaign_count,
      count(distinct origin_key) as origin_count
    from confirmed
    group by recipient_email
  ), ambiguous as (
    select * from recipient_summary
    where sender_count > 1 or lead_count > 1 or campaign_count > 1 or origin_count > 1
  ), ambiguous_preview as (
    select * from ambiguous order by recipient_email limit 500
  )
  select jsonb_build_object(
    'organizationId', p_organization_id,
    'generatedAt', now(),
    'confirmedRecipientCount', (select count(*) from recipient_summary),
    'ambiguousRecipientCount', (select count(*) from ambiguous),
    'ambiguousRecipientsTruncated', (select count(*) from ambiguous) > 500,
    'ambiguousRecipients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'recipientEmail', recipient_email,
        'sendCount', send_count,
        'senderCount', sender_count,
        'leadCount', lead_count,
        'campaignCount', campaign_count,
        'originCount', origin_count
      ) order by recipient_email)
      from ambiguous_preview
    ), '[]'::jsonb),
    'contactThreadCount', (
      select count(*) from public.organization_contact_threads
      where organization_id = p_organization_id
    ),
    'inFlightOrUnknownDispatchCount', (
      select count(*) from public.outbound_dispatches
      where organization_id = p_organization_id and status in ('sending', 'unknown')
    )
  ) into v_report;
  return v_report;
end;
$$;

create or replace function public.set_organization_collaboration_v1_enabled(
  p_organization_id uuid,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_enabled is null or length(trim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'Activation reason is required' using errcode = '22023';
  end if;

  v_report := public.organization_collaboration_rollout_report_v1(p_organization_id);
  update public.organizations
  set collaboration_v1_enabled = p_enabled
  where id = p_organization_id;
  if not found then raise exception 'Organization not found' using errcode = 'P0002'; end if;

  perform public.append_organization_collaboration_event_v1(
    p_organization_id,
    auth.uid(),
    case when p_enabled then 'organization.collaboration_enabled' else 'organization.collaboration_disabled' end,
    'organization',
    p_organization_id::text,
    null,
    null,
    jsonb_build_object('reason', trim(p_reason), 'rolloutReport', v_report)
  );
  return v_report || jsonb_build_object('enabled', p_enabled);
end;
$$;

create or replace function public.guard_organization_collaboration_flag_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.collaboration_v1_enabled is distinct from old.collaboration_v1_enabled
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Collaboration rollout is service-owned' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_organization_collaboration_flag on public.organizations;
create trigger guard_organization_collaboration_flag
  before update of collaboration_v1_enabled on public.organizations
  for each row execute function public.guard_organization_collaboration_flag_v1();

revoke all on function public.organization_collaboration_rollout_report_v1(uuid) from public, anon, authenticated;
revoke all on function public.set_organization_collaboration_v1_enabled(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.organization_collaboration_rollout_report_v1(uuid) to service_role;
grant execute on function public.set_organization_collaboration_v1_enabled(uuid, boolean, text) to service_role;

-- Reconcile organization and membership RLS to the role model above.
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'organization_members'
  loop execute format('drop policy if exists %I on public.organization_members', p.policyname); end loop;
  for p in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'organization_invites'
  loop execute format('drop policy if exists %I on public.organization_invites', p.policyname); end loop;
end;
$$;

alter table public.organization_lead_collaboration enable row level security;
alter table public.organization_contact_threads enable row level security;
alter table public.organization_collaboration_events enable row level security;

create policy "Members can view organization memberships v1"
  on public.organization_members for select to authenticated
  using (organization_id in (select public.get_my_org_ids()));
create policy "Admins can view organization invitations v1"
  on public.organization_invites for select to authenticated
  using (public.organization_has_role_v1(organization_id, array['owner', 'admin']));
create policy "Members can view lead collaboration v1"
  on public.organization_lead_collaboration for select to authenticated
  using (public.organization_has_role_v1(organization_id));
create policy "Members can view contact threads v1"
  on public.organization_contact_threads for select to authenticated
  using (public.organization_has_role_v1(organization_id));
create policy "Members can view collaboration events v1"
  on public.organization_collaboration_events for select to authenticated
  using (public.organization_has_role_v1(organization_id));

revoke all on table public.organization_members from anon, authenticated;
revoke all on table public.organization_invites from anon, authenticated;
revoke all on table public.organization_lead_collaboration from anon, authenticated;
revoke all on table public.organization_contact_threads from anon, authenticated;
revoke all on table public.organization_collaboration_events from anon, authenticated;
grant select on table public.organization_members to authenticated;
grant select on table public.organization_invites to authenticated;
grant select on table public.organization_lead_collaboration to authenticated;
grant select on table public.organization_contact_threads to authenticated;
grant select on table public.organization_collaboration_events to authenticated;
grant all on table public.organization_members to service_role;
grant all on table public.organization_invites to service_role;
grant all on table public.organization_lead_collaboration to service_role;
grant all on table public.organization_contact_threads to service_role;
grant select, insert on table public.organization_collaboration_events to service_role;

notify pgrst, 'reload schema';
