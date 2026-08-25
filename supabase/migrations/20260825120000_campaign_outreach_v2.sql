-- Personal follow-up Campaign Outreach V2. This slice is deliberately isolated
-- from legacy campaign scheduling and provider delivery.

create extension if not exists pgcrypto;

alter table public.organizations
  add column if not exists feature_campaigns_v2_enabled boolean not null default false;

alter table public.campaigns
  add column if not exists outreach_version smallint not null default 1,
  add column if not exists v2_status text,
  add column if not exists initial_native_draft_id uuid,
  add column if not exists v2_activated_at timestamptz,
  add column if not exists v2_stopped_at timestamptz;

alter table public.campaigns
  drop constraint if exists campaigns_outreach_version_check,
  add constraint campaigns_outreach_version_check check (outreach_version in (1, 2)),
  drop constraint if exists campaigns_v2_status_check,
  add constraint campaigns_v2_status_check check (
    v2_status is null or v2_status in ('draft', 'active', 'completed', 'stopped', 'blocked')
  ),
  drop constraint if exists campaigns_v2_shape_check,
  add constraint campaigns_v2_shape_check check (
    (outreach_version = 1 and v2_status is null and initial_native_draft_id is null)
    or (outreach_version = 2 and v2_status is not null and initial_native_draft_id is not null
      and organization_id is not null and user_id is not null)
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_id_organization_user_key'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_id_organization_user_key unique (id, organization_id, user_id);
  end if;
  alter table public.campaigns
    drop constraint if exists campaigns_initial_native_draft_fkey;
  alter table public.campaigns
    add constraint campaigns_initial_native_draft_fkey
    foreign key (initial_native_draft_id, organization_id, user_id)
    references public.messaging_drafts(id, organization_id, user_id)
    on delete cascade;
end;
$$;

create unique index if not exists campaigns_v2_initial_draft_uidx
  on public.campaigns(organization_id, initial_native_draft_id)
  where outreach_version = 2;

create index if not exists campaigns_v2_scope_status_idx
  on public.campaigns(organization_id, user_id, v2_status, created_at desc)
  where outreach_version = 2;

create table if not exists public.campaign_sequence_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_number integer not null,
  status text not null default 'published',
  content_hash text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint campaign_sequence_versions_number_check check (version_number >= 1),
  constraint campaign_sequence_versions_status_check check (status = 'published'),
  constraint campaign_sequence_versions_hash_check check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint campaign_sequence_versions_campaign_fkey
    foreign key (campaign_id, organization_id, user_id)
    references public.campaigns(id, organization_id, user_id) on delete cascade,
  unique (campaign_id, version_number),
  unique (id, organization_id, user_id)
);

create table if not exists public.campaign_sequence_steps_v2 (
  id uuid primary key default gen_random_uuid(),
  sequence_version_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_index integer not null,
  name text not null,
  offset_days integer not null,
  instruction text not null,
  created_at timestamptz not null default now(),
  constraint campaign_sequence_steps_v2_index_check check (step_index >= 0 and step_index <= 20),
  constraint campaign_sequence_steps_v2_name_check check (length(trim(name)) between 1 and 120),
  constraint campaign_sequence_steps_v2_offset_check check (
    (step_index = 0 and offset_days = 0) or (step_index > 0 and offset_days between 1 and 365)
  ),
  constraint campaign_sequence_steps_v2_instruction_check check (length(trim(instruction)) between 1 and 1000),
  constraint campaign_sequence_steps_v2_version_fkey
    foreign key (sequence_version_id, organization_id, user_id)
    references public.campaign_sequence_versions(id, organization_id, user_id) on delete cascade,
  unique (sequence_version_id, step_index),
  unique (id, organization_id, user_id)
);

create table if not exists public.campaign_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  sequence_version_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_name text,
  recipient_email text not null,
  recipient_lead_ref text,
  research_snapshot_id uuid not null,
  status text not null default 'pending_initial_send',
  initial_sent_at timestamptz,
  stopped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_enrollments_email_check check (
    length(trim(recipient_email)) between 3 and 320
    and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint campaign_enrollments_name_check check (recipient_name is null or length(trim(recipient_name)) between 1 and 300),
  constraint campaign_enrollments_lead_ref_check check (recipient_lead_ref is null or length(trim(recipient_lead_ref)) between 1 and 500),
  constraint campaign_enrollments_status_check check (
    status in ('pending_initial_send', 'active', 'completed', 'stopped', 'blocked')
  ),
  constraint campaign_enrollments_campaign_fkey
    foreign key (campaign_id, organization_id, user_id)
    references public.campaigns(id, organization_id, user_id) on delete cascade,
  constraint campaign_enrollments_version_fkey
    foreign key (sequence_version_id, organization_id, user_id)
    references public.campaign_sequence_versions(id, organization_id, user_id) on delete restrict,
  constraint campaign_enrollments_snapshot_fkey
    foreign key (research_snapshot_id, organization_id, user_id)
    references public.research_snapshots(id, organization_id, user_id) on delete restrict,
  unique (campaign_id, recipient_email),
  unique (id, organization_id, user_id)
);

create table if not exists public.campaign_recipient_steps (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null,
  campaign_id uuid not null,
  sequence_step_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_index integer not null,
  state text not null,
  due_at timestamptz,
  inbox_order_at timestamptz,
  native_draft_id uuid,
  native_version_id uuid,
  outbound_dispatch_id uuid,
  contacted_id text,
  sent_at timestamptz,
  last_error text,
  preparation_claim_token uuid,
  preparation_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_recipient_steps_index_check check (step_index >= 0 and step_index <= 20),
  constraint campaign_recipient_steps_state_check check (state in (
    'pending_initial_send', 'not_due', 'ready_to_prepare', 'drafting',
    'review_required', 'approved', 'dispatch_pending', 'sending', 'sent',
    'deferred', 'failed', 'unknown', 'skipped', 'blocked'
  )),
  constraint campaign_recipient_steps_draft_pair_check check (
    (native_draft_id is null and native_version_id is null)
    or (native_draft_id is not null and native_version_id is not null)
  ),
  constraint campaign_recipient_steps_sent_check check (
    state <> 'sent' or sent_at is not null
  ),
  constraint campaign_recipient_steps_preparation_claim_check check (
    (state = 'drafting' and preparation_claim_token is not null and preparation_claimed_at is not null)
    or (state <> 'drafting' and preparation_claim_token is null and preparation_claimed_at is null)
  ),
  constraint campaign_recipient_steps_enrollment_fkey
    foreign key (enrollment_id, organization_id, user_id)
    references public.campaign_enrollments(id, organization_id, user_id) on delete cascade,
  constraint campaign_recipient_steps_campaign_fkey
    foreign key (campaign_id, organization_id, user_id)
    references public.campaigns(id, organization_id, user_id) on delete cascade,
  constraint campaign_recipient_steps_sequence_step_fkey
    foreign key (sequence_step_id, organization_id, user_id)
    references public.campaign_sequence_steps_v2(id, organization_id, user_id) on delete restrict,
  constraint campaign_recipient_steps_native_version_fkey
    foreign key (native_draft_id, native_version_id, organization_id, user_id)
    references public.messaging_draft_versions(draft_id, id, organization_id, user_id) on delete restrict,
  unique (enrollment_id, step_index),
  unique (id, organization_id, user_id)
);

create unique index if not exists campaign_recipient_steps_native_draft_uidx
  on public.campaign_recipient_steps(organization_id, native_draft_id)
  where native_draft_id is not null;
create index if not exists campaign_recipient_steps_inbox_idx
  on public.campaign_recipient_steps(organization_id, state, inbox_order_at, id);
create index if not exists campaign_recipient_steps_due_idx
  on public.campaign_recipient_steps(due_at, id)
  where state = 'not_due' and due_at is not null;
create index if not exists campaign_enrollments_scope_status_idx
  on public.campaign_enrollments(organization_id, status, updated_at desc);

create or replace function public.assign_campaign_recipient_step_inbox_order_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.inbox_order_at is not null then
    new.inbox_order_at := old.inbox_order_at;
  elsif new.inbox_order_at is null
    and not (new.state = 'not_due' and new.due_at is null) then
    new.inbox_order_at := coalesce(new.due_at, new.created_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists assign_campaign_recipient_step_inbox_order_v2 on public.campaign_recipient_steps;
create trigger assign_campaign_recipient_step_inbox_order_v2
  before insert or update on public.campaign_recipient_steps
  for each row execute function public.assign_campaign_recipient_step_inbox_order_v2();

alter table public.outbound_dispatches
  add column if not exists campaign_recipient_step_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outbound_dispatches_campaign_recipient_step_fkey'
      and conrelid = 'public.outbound_dispatches'::regclass
  ) then
    alter table public.outbound_dispatches
      add constraint outbound_dispatches_campaign_recipient_step_fkey
      foreign key (campaign_recipient_step_id, organization_id, user_id)
      references public.campaign_recipient_steps(id, organization_id, user_id)
      on delete restrict;
  end if;
end;
$$;

create unique index if not exists outbound_dispatches_campaign_recipient_step_uidx
  on public.outbound_dispatches(campaign_recipient_step_id)
  where campaign_recipient_step_id is not null;

-- A known rejection before the first provider attempt must be terminal without
-- fabricating a provider attempt. All ordinary failed dispatches retain the
-- inherited started_at and attempt_count requirements.
alter table public.outbound_dispatches
  drop constraint if exists outbound_dispatches_state_check,
  add constraint outbound_dispatches_state_check check (
    (status = 'pending' and started_at is null and completed_at is null and attempt_count = 0)
    or (status = 'sending' and started_at is not null and completed_at is null and attempt_count >= 1)
    or (status = 'sent' and started_at is not null and completed_at is not null and attempt_count >= 1 and provider_message_id is not null)
    or (status = 'failed' and started_at is not null and completed_at is not null and attempt_count >= 1 and error_message is not null)
    or (
      status = 'failed'
      and started_at is null
      and completed_at is not null
      and attempt_count = 0
      and provider_message_id is null
      and error_code = 'pre_provider_rejected'
      and error_message is not null
      and provider_response ->> 'providerInvoked' = 'false'
    )
    or (status = 'deferred' and started_at is not null and completed_at is not null and attempt_count >= 1 and provider_message_id is null and error_message is not null)
    or (status = 'unknown' and completed_at is not null and error_message is not null)
  );

-- A deterministic rejection before provider invocation is terminal and known.
-- Keep this transition narrower than a normal provider failure so callers cannot
-- label an ambiguous delivery as failed.
create or replace function public.enforce_outbound_dispatch_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.privacy_delete', true), '') = 'on' then
      return old;
    end if;
    raise exception 'outbound dispatches cannot be deleted' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'outbound dispatches must be created pending' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.messaging_draft_versions mdv
      where mdv.draft_id = new.draft_id
        and mdv.id = new.version_id
        and mdv.organization_id = new.organization_id
        and mdv.user_id = new.user_id
        and mdv.revision = (new.metadata ->> 'revision')::integer
        and mdv.channel = new.channel
        and mdv.recipient = new.metadata -> 'recipient'
        and mdv.content_hash = new.content_hash
    ) then
      raise exception 'outbound dispatch metadata does not match draft version' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.draft_id is distinct from old.draft_id
    or new.version_id is distinct from old.version_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.content_hash is distinct from old.content_hash
    or new.channel is distinct from old.channel
    or new.provider is distinct from old.provider
    or new.metadata is distinct from old.metadata
    or new.requested_at is distinct from old.requested_at
    or new.created_at is distinct from old.created_at then
    raise exception 'outbound dispatch identity is immutable' using errcode = '55000';
  end if;

  if new.reconciliation_attempt_count < old.reconciliation_attempt_count
    or new.attempt_count < old.attempt_count then
    raise exception 'outbound dispatch counters cannot decrease' using errcode = '55000';
  end if;

  if old.status = 'pending'
    and new.status = 'sending'
    and new.attempt_count = old.attempt_count + 1 then
    return new;
  end if;
  if old.status = 'pending'
    and new.status = 'unknown'
    and new.attempt_count = old.attempt_count then
    return new;
  end if;
  if old.status in ('pending', 'deferred')
    and new.status = 'failed'
    and new.attempt_count = old.attempt_count
    and new.provider_message_id is null
    and new.error_code = 'pre_provider_rejected'
    and new.provider_response ->> 'providerInvoked' = 'false' then
    return new;
  end if;
  if old.status = 'sending'
    and new.status = 'unknown'
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count
    and new.reconciliation_claimed_at is not null
    and new.last_reconciliation_at is not distinct from old.last_reconciliation_at
    and new.reconciled_at is not distinct from old.reconciled_at
    and new.reconciliation_details is not distinct from old.reconciliation_details then
    return new;
  end if;
  if old.status = 'sending'
    and new.status in ('sent', 'failed', 'deferred', 'unknown')
    and new.attempt_count = old.attempt_count then
    return new;
  end if;
  if old.status = 'deferred'
    and new.status = 'sending'
    and new.attempt_count = old.attempt_count + 1
    and new.provider_message_id is null
    and new.provider_response is null
    and new.error_code is null
    and new.error_message is null then
    return new;
  end if;
  if old.status = 'deferred'
    and new.status = 'unknown'
    and new.attempt_count = old.attempt_count then
    return new;
  end if;
  if old.status = 'unknown'
    and new.status = 'unknown'
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count
    and new.reconciliation_claimed_at is not null
    and new.reconciliation_claimed_at is distinct from old.reconciliation_claimed_at
    and new.last_reconciliation_at is not distinct from old.last_reconciliation_at
    and new.reconciled_at is not distinct from old.reconciled_at
    and new.reconciliation_details is not distinct from old.reconciliation_details then
    return new;
  end if;
  if old.status = 'unknown'
    and new.status = 'unknown'
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count
    and old.reconciliation_claimed_at is not null
    and new.reconciliation_claimed_at is null
    and new.last_reconciliation_at is not distinct from old.last_reconciliation_at
    and new.reconciled_at is not distinct from old.reconciled_at
    and new.reconciliation_details is not distinct from old.reconciliation_details then
    return new;
  end if;
  if old.status = 'unknown'
    and new.status in ('unknown', 'sent', 'failed')
    and new.reconciliation_attempt_count = old.reconciliation_attempt_count + 1
    and new.last_reconciliation_at is not null
    and (new.status = 'unknown' or new.reconciled_at is not null) then
    return new;
  end if;
  if old.status = 'sent'
    and new.status = 'sent'
    and old.history_repair_status in ('pending', 'failed')
    and new.history_repair_status in ('complete', 'failed')
    and new.history_repair_attempt_count = old.history_repair_attempt_count + 1
    and new.last_history_repair_at is not null
    and (
      (new.history_repair_status = 'complete' and new.history_repair_error is null)
      or (new.history_repair_status = 'failed' and length(trim(coalesce(new.history_repair_error, ''))) > 0)
    )
    and to_jsonb(new) - array[
      'history_repair_status', 'history_repair_attempt_count',
      'last_history_repair_at', 'history_repair_error'
    ] = to_jsonb(old) - array[
      'history_repair_status', 'history_repair_attempt_count',
      'last_history_repair_at', 'history_repair_error'
    ] then
    return new;
  end if;

  raise exception 'invalid outbound dispatch transition: % -> %', old.status, new.status
    using errcode = '55000';
end;
$$;

create or replace function public.guard_campaigns_v2_authenticated_writes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' and new.outreach_version = 2 then
    raise exception 'Campaign V2 writes are server-owned' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and old.outreach_version = 2 then
    raise exception 'Campaign V2 writes are server-owned' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.outreach_version = 2 or new.outreach_version = 2) then
    raise exception 'Campaign V2 rows are server-owned' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_campaigns_v2_authenticated_writes on public.campaigns;
create trigger guard_campaigns_v2_authenticated_writes
  before insert or update or delete on public.campaigns
  for each row execute function public.guard_campaigns_v2_authenticated_writes();

create or replace function public.guard_campaigns_v2_feature_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
    and new.feature_campaigns_v2_enabled is distinct from old.feature_campaigns_v2_enabled then
    raise exception 'Campaign V2 feature access is server-owned' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_campaigns_v2_feature_flag on public.organizations;
create trigger guard_campaigns_v2_feature_flag
  before update on public.organizations
  for each row execute function public.guard_campaigns_v2_feature_flag();

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
  v_recipient_email text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_started_at is null or p_expected_attempt_count is null
    or p_expected_attempt_count < 0 then
    raise exception 'invalid outbound dispatch sending claim' using errcode = '22023';
  end if;

  select lower(trim(coalesce(
    nullif(od.metadata #>> '{recipient,email}', ''),
    nullif(mdv.recipient ->> 'email', '')
  )))
  into v_recipient_email
  from public.outbound_dispatches od
  left join public.messaging_draft_versions mdv on mdv.id = od.version_id
  where od.id = p_dispatch_id;
  if not found then
    raise exception 'Outbound dispatch was not found' using errcode = 'P0002';
  end if;

  if v_recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_recipient_email), 0));
  end if;

  update public.outbound_dispatches
  set status = 'sending',
      started_at = p_started_at,
      completed_at = null,
      provider_message_id = null,
      provider_response = null,
      error_code = null,
      error_message = null,
      updated_at = p_started_at,
      attempt_count = p_expected_attempt_count + 1
  where id = p_dispatch_id
    and status in ('pending', 'deferred')
    and attempt_count = p_expected_attempt_count
  returning * into v_dispatch;
  if found then
    return jsonb_build_object('claimed', true, 'dispatch', to_jsonb(v_dispatch));
  end if;

  select * into v_dispatch
  from public.outbound_dispatches
  where id = p_dispatch_id;
  if not found then
    raise exception 'Outbound dispatch was not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('claimed', false, 'dispatch', to_jsonb(v_dispatch));
end;
$$;

create or replace function public.reject_published_campaign_sequence_change_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and (
    coalesce(auth.role(), '') = 'service_role'
    or coalesce(current_setting('app.privacy_delete', true), '') = 'on'
  ) then
    return old;
  end if;
  raise exception 'Published Campaign V2 sequence rows are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists campaign_sequence_versions_immutable_v2 on public.campaign_sequence_versions;
create trigger campaign_sequence_versions_immutable_v2
  before update or delete on public.campaign_sequence_versions
  for each row execute function public.reject_published_campaign_sequence_change_v2();
drop trigger if exists campaign_sequence_steps_immutable_v2 on public.campaign_sequence_steps_v2;
create trigger campaign_sequence_steps_immutable_v2
  before update or delete on public.campaign_sequence_steps_v2
  for each row execute function public.reject_published_campaign_sequence_change_v2();

create or replace function public.bind_campaign_recipient_step_dispatch_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_draft public.messaging_drafts%rowtype;
  v_version public.messaging_draft_versions%rowtype;
  v_feature_enabled boolean;
  v_recipient_email text;
begin
  -- Plan creation and every dispatch insert for this draft share one transaction lock.
  perform pg_advisory_xact_lock(hashtextextended(concat(
    'campaign-v2-draft:', new.organization_id, ':', new.draft_id
  ), 0));

  -- Drafts without a V2 step mapping retain the legacy dispatch behavior.
  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.organization_id = new.organization_id
    and crs.user_id = new.user_id
    and crs.native_draft_id = new.draft_id;

  if not found then
    if new.campaign_recipient_step_id is not null then
      raise exception 'Outbound dispatch Campaign V2 step does not match its native draft' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.campaign_recipient_step_id is not null
    and new.campaign_recipient_step_id is distinct from v_step.id then
    raise exception 'Outbound dispatch Campaign V2 step does not match its native draft' using errcode = '23514';
  end if;

  select lower(trim(ce.recipient_email)) into v_recipient_email
  from public.campaign_enrollments ce
  where ce.id = v_step.enrollment_id
    and ce.organization_id = v_step.organization_id
    and ce.user_id = v_step.user_id;
  if v_recipient_email is null then
    raise exception 'Outbound dispatch Campaign V2 enrollment identity is invalid' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_recipient_email), 0));

  -- Draft mutations lock the draft before their version trigger touches a step.
  -- Match that row order so dispatch insertion cannot deadlock a revision.
  select md.* into v_draft
  from public.messaging_drafts md
  where md.id = new.draft_id
    and md.organization_id = new.organization_id
    and md.user_id = new.user_id
  for share;
  if not found
    or v_draft.current_version_id is distinct from new.version_id
    or v_draft.lifecycle <> 'ready'
    or v_draft.channel <> new.channel then
    raise exception 'Campaign V2 dispatch draft is not current and ready' using errcode = '55000';
  end if;

  -- Stop and finalization use the same campaign -> enrollment -> step order.
  select o.feature_campaigns_v2_enabled into v_feature_enabled
  from public.organizations o
  where o.id = v_step.organization_id
  for share;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_step.campaign_id
    and c.organization_id = v_step.organization_id
    and c.user_id = v_step.user_id
  for update;
  if not found or v_campaign.outreach_version <> 2 then
    raise exception 'Outbound dispatch Campaign V2 campaign identity is invalid' using errcode = '23514';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.id = v_step.enrollment_id
    and ce.campaign_id = v_step.campaign_id
    and ce.organization_id = v_step.organization_id
    and ce.user_id = v_step.user_id
  for update;
  if not found then
    raise exception 'Outbound dispatch Campaign V2 enrollment identity is invalid' using errcode = '23514';
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = v_step.id
    and crs.organization_id = new.organization_id
    and crs.user_id = new.user_id
    and crs.native_draft_id = new.draft_id
  for update;
  if not found then
    raise exception 'Outbound dispatch Campaign V2 step changed while claiming dispatch' using errcode = '40001';
  end if;

  if not coalesce(v_feature_enabled, false) then
    raise exception 'Campaign V2 is not enabled' using errcode = '42501';
  end if;
  if v_campaign.v2_status in ('stopped', 'blocked')
    or v_enrollment.status in ('stopped', 'blocked')
    or v_step.state in ('sent', 'skipped', 'blocked') then
    raise exception 'Campaign V2 recipient is stopped or blocked' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.campaign_sequence_steps_v2 css
    where css.id = v_step.sequence_step_id
      and css.sequence_version_id = v_enrollment.sequence_version_id
      and css.organization_id = v_step.organization_id
      and css.user_id = v_step.user_id
  ) then
    raise exception 'Campaign V2 step is not part of the enrolled sequence version' using errcode = '23514';
  end if;
  if (
    v_step.step_index = 0
    and not (
      v_campaign.v2_status = 'draft'
      and v_enrollment.status = 'pending_initial_send'
      and v_step.state = 'pending_initial_send'
    )
  ) or (
    v_step.step_index > 0
    and not (
      v_campaign.v2_status = 'active'
      and v_enrollment.status = 'active'
      and v_step.state = 'approved'
    )
  ) then
    raise exception 'Campaign V2 campaign, enrollment, or step is not dispatchable' using errcode = '55000';
  end if;
  if v_step.outbound_dispatch_id is not null or exists (
    select 1
    from public.outbound_dispatches od
    where od.campaign_recipient_step_id = v_step.id
  ) then
    raise exception 'Campaign V2 recipient step already has an outbound dispatch' using errcode = '23505';
  end if;

  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.draft_id = new.draft_id
    and mdv.id = new.version_id
    and mdv.organization_id = new.organization_id
    and mdv.user_id = new.user_id;
  if not found
    or v_version.lifecycle <> 'ready'
    or v_version.approval ->> 'status' <> 'approved'
    or v_version.preflight ->> 'status' <> 'passed' then
    raise exception 'Campaign V2 dispatch version is not approved and ready' using errcode = '55000';
  end if;

  if v_recipient_email <> lower(trim(v_enrollment.recipient_email)) then
    raise exception 'Campaign V2 recipient changed while claiming dispatch' using errcode = '40001';
  end if;
  if lower(trim(coalesce(v_version.recipient ->> 'email', ''))) <> v_recipient_email then
    raise exception 'Campaign V2 dispatch recipient does not match enrollment' using errcode = '23514';
  end if;
  -- Unsafe contacted-lead writes take the same privacy advisory lock. A plain
  -- read below avoids row-lock -> advisory-lock inversion while preserving one
  -- linearization point for send versus safety updates.
  if exists (
    select 1 from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_recipient_email
      and ((ue.user_id is null and ue.organization_id is null)
        or ue.user_id = new.user_id or ue.organization_id = new.organization_id)
  ) then
    raise exception 'Campaign V2 recipient is suppressed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contacted_leads cl
    where cl.organization_id = new.organization_id
      and cl.user_id = new.user_id
      and lower(trim(coalesce(cl.email, ''))) = v_recipient_email
      and (lower(coalesce(cl.evaluation_status, '')) = 'do_not_contact'
        or cl.campaign_followup_allowed is false
        or cl.replied_at is not null or lower(coalesce(cl.status, '')) = 'replied'
        or lower(coalesce(cl.delivery_status, '')) = 'replied'
        or nullif(trim(coalesce(cl.reply_intent, '')), '') is not null
        or nullif(trim(coalesce(cl.last_reply_text, '')), '') is not null)
  ) then
    raise exception 'Campaign V2 recipient has replied' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.leads l
    where l.organization_id = new.organization_id
      and l.user_id = new.user_id
      and lower(trim(coalesce(l.email, ''))) = v_recipient_email
      and lower(coalesce(l.status, '')) = 'do_not_contact'
  ) then
    raise exception 'Campaign V2 recipient is marked do not contact' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.contacted_leads cl
    where cl.organization_id = new.organization_id
      and cl.user_id = new.user_id
      and lower(trim(coalesce(cl.email, ''))) = v_recipient_email
      and (cl.bounced_at is not null
        or lower(coalesce(cl.delivery_status, '')) in ('soft_bounced', 'hard_bounced', 'bounced')
        or lower(coalesce(cl.lifecycle_state, '')) = 'bounced')
  ) then
    raise exception 'Campaign V2 recipient has bounced' using errcode = '55000';
  end if;

  update public.campaign_recipient_steps
  set outbound_dispatch_id = new.id,
      state = 'dispatch_pending',
      preparation_claim_token = null,
      preparation_claimed_at = null,
      last_error = null,
      updated_at = now()
  where id = v_step.id
    and outbound_dispatch_id is null;
  if not found then
    raise exception 'Campaign V2 recipient step dispatch claim was lost' using errcode = '40001';
  end if;

  new.campaign_recipient_step_id := v_step.id;
  return new;
end;
$$;

drop trigger if exists campaign_v2_bind_outbound_dispatch on public.outbound_dispatches;
create trigger campaign_v2_bind_outbound_dispatch
  before insert on public.outbound_dispatches
  for each row execute function public.bind_campaign_recipient_step_dispatch_v2();

create or replace function public.guard_campaign_recipient_step_dispatch_link_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_draft public.messaging_drafts%rowtype;
  v_version public.messaging_draft_versions%rowtype;
  v_feature_enabled boolean;
  v_recipient_email text;
begin
  if new.campaign_recipient_step_id is distinct from old.campaign_recipient_step_id then
    raise exception 'Outbound dispatch Campaign V2 identity is immutable' using errcode = '55000';
  end if;
  if new.campaign_recipient_step_id is null
    or new.status <> 'sending'
    or new.status is not distinct from old.status then
    return new;
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = new.campaign_recipient_step_id
    and crs.organization_id = new.organization_id
    and crs.user_id = new.user_id
    and crs.native_draft_id = new.draft_id
    and crs.native_version_id = new.version_id
    and crs.outbound_dispatch_id = new.id;
  if not found then
    raise exception 'Campaign V2 dispatch claim is invalid before provider delivery' using errcode = '55000';
  end if;

  select lower(trim(ce.recipient_email)) into v_recipient_email
  from public.campaign_enrollments ce
  where ce.id = v_step.enrollment_id
    and ce.campaign_id = v_step.campaign_id
    and ce.organization_id = new.organization_id
    and ce.user_id = new.user_id;
  if v_recipient_email is null then
    raise exception 'Campaign V2 enrollment is invalid before provider delivery' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_recipient_email), 0));

  select o.feature_campaigns_v2_enabled into v_feature_enabled
  from public.organizations o
  where o.id = new.organization_id
  for share;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_step.campaign_id
    and c.organization_id = new.organization_id
    and c.user_id = new.user_id
    and c.outreach_version = 2
  for update;
  if not found or not coalesce(v_feature_enabled, false) then
    raise exception 'Campaign V2 is not enabled for provider delivery' using errcode = '42501';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.id = v_step.enrollment_id
    and ce.campaign_id = v_step.campaign_id
    and ce.organization_id = new.organization_id
    and ce.user_id = new.user_id
  for update;
  if not found then
    raise exception 'Campaign V2 enrollment is invalid before provider delivery' using errcode = '55000';
  end if;
  if lower(trim(v_enrollment.recipient_email)) <> v_recipient_email then
    raise exception 'Campaign V2 recipient changed while acquiring safety lock' using errcode = '40001';
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = new.campaign_recipient_step_id
    and crs.outbound_dispatch_id = new.id
  for update;
  if not found
    or v_step.state not in ('dispatch_pending', 'deferred')
    or (v_step.step_index = 0 and (
      v_campaign.v2_status <> 'draft' or v_enrollment.status <> 'pending_initial_send'
    ))
    or (v_step.step_index > 0 and (
      v_campaign.v2_status <> 'active' or v_enrollment.status <> 'active'
    )) then
    raise exception 'Campaign V2 recipient step is not sendable before provider delivery' using errcode = '55000';
  end if;

  select md.* into v_draft
  from public.messaging_drafts md
  where md.id = new.draft_id
    and md.organization_id = new.organization_id
    and md.user_id = new.user_id
  for share;
  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.draft_id = new.draft_id
    and mdv.id = new.version_id
    and mdv.organization_id = new.organization_id
    and mdv.user_id = new.user_id;
  if v_draft.current_version_id is distinct from new.version_id
    or v_draft.lifecycle <> 'ready'
    or v_version.lifecycle <> 'ready'
    or v_version.approval ->> 'status' <> 'approved'
    or v_version.preflight ->> 'status' <> 'passed' then
    raise exception 'Campaign V2 draft is not current and approved before provider delivery' using errcode = '55000';
  end if;

  if lower(trim(coalesce(v_version.recipient ->> 'email', ''))) <> v_recipient_email then
    raise exception 'Campaign V2 recipient changed before provider delivery' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_recipient_email
      and ((ue.user_id is null and ue.organization_id is null)
        or ue.user_id = new.user_id or ue.organization_id = new.organization_id)
  ) or exists (
    select 1 from public.contacted_leads cl
    where cl.organization_id = new.organization_id
      and cl.user_id = new.user_id
      and lower(trim(coalesce(cl.email, ''))) = v_recipient_email
      and (lower(coalesce(cl.evaluation_status, '')) = 'do_not_contact'
        or cl.campaign_followup_allowed is false
        or cl.replied_at is not null or lower(coalesce(cl.status, '')) = 'replied'
        or lower(coalesce(cl.delivery_status, '')) = 'replied'
        or nullif(trim(coalesce(cl.reply_intent, '')), '') is not null
        or nullif(trim(coalesce(cl.last_reply_text, '')), '') is not null
        or cl.bounced_at is not null
        or lower(coalesce(cl.delivery_status, '')) in ('soft_bounced', 'hard_bounced', 'bounced')
        or lower(coalesce(cl.lifecycle_state, '')) = 'bounced')
  ) or exists (
    select 1 from public.leads l
    where l.organization_id = new.organization_id
      and l.user_id = new.user_id
      and lower(trim(coalesce(l.email, ''))) = v_recipient_email
      and lower(coalesce(l.status, '')) = 'do_not_contact'
  ) then
    raise exception 'Campaign V2 recipient became unsafe before provider delivery' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_v2_guard_outbound_dispatch_link on public.outbound_dispatches;
create trigger campaign_v2_guard_outbound_dispatch_link
  before update on public.outbound_dispatches
  for each row execute function public.guard_campaign_recipient_step_dispatch_link_v2();

create or replace function public.sync_campaign_recipient_step_draft_review_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.campaign_recipient_steps crs
  set native_version_id = new.id,
      state = case
        when crs.step_index = 0 then crs.state
        when new.lifecycle = 'ready'
          and new.approval ->> 'status' = 'approved'
          and new.preflight ->> 'status' = 'passed' then 'approved'
        else 'review_required'
      end,
      preparation_claim_token = null,
      preparation_claimed_at = null,
      last_error = null,
      updated_at = now()
  where crs.organization_id = new.organization_id
    and crs.user_id = new.user_id
    and crs.native_draft_id = new.draft_id
    and crs.outbound_dispatch_id is null
    and crs.state not in ('sent', 'skipped', 'blocked');
  return new;
end;
$$;

drop trigger if exists sync_campaign_recipient_step_draft_review_v2 on public.messaging_draft_versions;
create trigger sync_campaign_recipient_step_draft_review_v2
  after insert on public.messaging_draft_versions
  for each row execute function public.sync_campaign_recipient_step_draft_review_v2();

create or replace function public.lock_unsubscribed_email_privacy_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email <> '' and not pg_try_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0)) then
    raise exception 'privacy deletion is in progress' using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists unsubscribed_emails_privacy_lock_v2 on public.unsubscribed_emails;
create trigger unsubscribed_emails_privacy_lock_v2
  before insert or update on public.unsubscribed_emails
  for each row execute function public.lock_unsubscribed_email_privacy_v2();

create or replace function public.lock_contacted_lead_campaign_safety_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email <> '' and (
    lower(coalesce(new.evaluation_status, '')) = 'do_not_contact'
    or new.campaign_followup_allowed is false
    or new.replied_at is not null
    or lower(coalesce(new.status, '')) = 'replied'
    or lower(coalesce(new.delivery_status, '')) in ('replied', 'soft_bounced', 'hard_bounced', 'bounced')
    or nullif(trim(coalesce(new.reply_intent, '')), '') is not null
    or nullif(trim(coalesce(new.last_reply_text, '')), '') is not null
    or new.bounced_at is not null
    or lower(coalesce(new.lifecycle_state, '')) = 'bounced'
  ) and not pg_try_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0)) then
    -- Do not wait for an advisory lock while this row update already holds a
    -- contacted_leads lock. Retrying avoids a row/advisory deadlock.
    raise exception 'privacy deletion is in progress' using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists contacted_leads_campaign_safety_lock_v2 on public.contacted_leads;
create trigger contacted_leads_campaign_safety_lock_v2
  before insert or update on public.contacted_leads
  for each row execute function public.lock_contacted_lead_campaign_safety_v2();

create or replace function public.lock_lead_campaign_safety_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email <> ''
    and lower(coalesce(new.status, '')) = 'do_not_contact'
    and not pg_try_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0)) then
    -- Match contacted_leads: fail retryably rather than waiting while a row
    -- lock is held ahead of a privacy deletion transaction.
    raise exception 'privacy deletion is in progress' using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_campaign_safety_lock_v2 on public.leads;
create trigger leads_campaign_safety_lock_v2
  before insert or update on public.leads
  for each row execute function public.lock_lead_campaign_safety_v2();

create or replace function public.safety_stop_campaign_recipient_v2(
  p_email text,
  p_reason text default 'recipient_suppressed',
  p_organization_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'recipient_suppressed');
  v_candidate record;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_blocked_enrollments integer := 0;
  v_blocked_campaigns integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  for v_candidate in
    select c.id as campaign_id, ce.id as enrollment_id,
      ce.organization_id, ce.user_id
    from public.campaign_enrollments ce
    join public.campaigns c
      on c.id = ce.campaign_id
      and c.organization_id = ce.organization_id
      and c.user_id = ce.user_id
      and c.outreach_version = 2
    where lower(trim(ce.recipient_email)) = v_email
      and (p_organization_id is null or ce.organization_id = p_organization_id)
      and (p_user_id is null or ce.user_id = p_user_id)
      and ce.status in ('pending_initial_send', 'active')
      and c.v2_status in ('draft', 'active')
    order by c.id, ce.id
  loop
    select c.* into v_campaign
    from public.campaigns c
    where c.id = v_candidate.campaign_id
      and c.organization_id = v_candidate.organization_id
      and c.user_id = v_candidate.user_id
      and c.outreach_version = 2
      and c.v2_status in ('draft', 'active')
    for update;
    if not found then
      continue;
    end if;

    select ce.* into v_enrollment
    from public.campaign_enrollments ce
    where ce.id = v_candidate.enrollment_id
      and ce.campaign_id = v_campaign.id
      and ce.organization_id = v_candidate.organization_id
      and ce.user_id = v_candidate.user_id
      and ce.status in ('pending_initial_send', 'active')
      and lower(trim(ce.recipient_email)) = v_email
    for update;
    if not found then
      continue;
    end if;

    perform 1
    from public.campaign_recipient_steps crs
    where crs.enrollment_id = v_enrollment.id
    order by crs.step_index
    for update;

    update public.campaign_recipient_steps
    set state = 'blocked',
        preparation_claim_token = null,
        preparation_claimed_at = null,
        last_error = v_reason,
        updated_at = now()
    where enrollment_id = v_enrollment.id
      and state not in ('sent', 'skipped', 'blocked', 'sending', 'unknown');

    update public.campaign_enrollments
    set status = 'blocked', updated_at = now()
    where id = v_enrollment.id
      and status in ('pending_initial_send', 'active');
    if found then
      v_blocked_enrollments := v_blocked_enrollments + 1;
    end if;

    update public.campaigns
    set v2_status = 'blocked', updated_at = now()
    where id = v_campaign.id
      and v2_status in ('draft', 'active');
    if found then
      v_blocked_campaigns := v_blocked_campaigns + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'email', v_email,
    'organizationId', p_organization_id,
    'userId', p_user_id,
    'blockedEnrollments', v_blocked_enrollments,
    'blockedCampaigns', v_blocked_campaigns
  );
end;
$$;

create or replace function public.safety_stop_campaign_recipient_from_contacted_v2(
  p_contacted_id text,
  p_reason text default 'recipient_replied'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacted_leads%rowtype;
  v_email text;
  v_safety_stop jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_contacted_id, '')), '') is null then
    raise exception 'contacted id is required' using errcode = '22023';
  end if;

  select cl.* into v_contact
  from public.contacted_leads cl
  where cl.id = trim(p_contacted_id);
  if not found then
    return jsonb_build_object('matched', false, 'reason', 'contact_missing');
  end if;
  if v_contact.user_id is null or v_contact.organization_id is null then
    return jsonb_build_object('matched', false, 'reason', 'contact_scope_missing');
  end if;

  v_email := lower(trim(coalesce(v_contact.email, '')));
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('matched', false, 'reason', 'contact_email_missing');
  end if;

  v_safety_stop := public.safety_stop_campaign_recipient_v2(
    v_email,
    p_reason,
    v_contact.organization_id,
    v_contact.user_id
  );
  return jsonb_build_object(
    'matched', true,
    'contactedId', v_contact.id,
    'campaignSafetyStop', v_safety_stop
  );
end;
$$;

create or replace function public.record_scoped_unsubscribe_v2(
  p_email text,
  p_user_id uuid,
  p_organization_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'recipient_unsubscribed');
  v_unsubscribe_id uuid;
  v_safety_stop jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'unsubscribe user scope is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  insert into public.unsubscribed_emails (email, user_id, organization_id, reason)
  values (v_email, p_user_id, p_organization_id, v_reason)
  on conflict (email, user_id, organization_id)
  do update set reason = excluded.reason
  returning id into v_unsubscribe_id;

  v_safety_stop := public.safety_stop_campaign_recipient_v2(
    v_email,
    'recipient_unsubscribed',
    p_organization_id,
    p_user_id
  );

  return jsonb_build_object(
    'recorded', true,
    'id', v_unsubscribe_id,
    'email', v_email,
    'campaignSafetyStop', v_safety_stop
  );
end;
$$;

-- The inbound core persists the event and contact state. Keep the opt-out and
-- Campaign V2 stop in this wrapper so all reply-side effects commit or roll
-- back together, including idempotent duplicate repair.
alter function public.ingest_inbound_reply_v1(
  text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) rename to ingest_inbound_reply_core_v1;

create or replace function public.ingest_inbound_reply_v1(
  p_contacted_id text,
  p_recipient_email text,
  p_provider text,
  p_message_id text,
  p_internet_message_id text,
  p_event_type text,
  p_event_source text,
  p_event_at timestamptz,
  p_thread_key text,
  p_thread_id text,
  p_conversation_id text,
  p_subject text,
  p_content text,
  p_preview text,
  p_classification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_event_key text;
  v_contact_email text;
  v_explicit_unsubscribe boolean := p_classification is not null
    and jsonb_typeof(p_classification) = 'object'
    and lower(trim(coalesce(p_classification ->> 'intent', ''))) = 'unsubscribe';
begin
  v_result := public.ingest_inbound_reply_core_v1(
    p_contacted_id,
    p_recipient_email,
    p_provider,
    p_message_id,
    p_internet_message_id,
    p_event_type,
    p_event_source,
    p_event_at,
    p_thread_key,
    p_thread_id,
    p_conversation_id,
    p_subject,
    p_content,
    p_preview,
    p_classification
  );

  if coalesce((v_result ->> 'inserted')::boolean, false)
    or v_result ->> 'reason' = 'duplicate' then
    v_event_key := nullif(trim(coalesce(v_result ->> 'eventKey', '')), '');

    if v_explicit_unsubscribe and v_event_key is not null then
      select nullif(lower(trim(coalesce(cl.email, ''))), '')
      into v_contact_email
      from public.contacted_leads cl
      where cl.id = trim(p_contacted_id);

      if v_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        perform public.record_inbound_unsubscribe_v1(
          trim(p_contacted_id),
          v_contact_email,
          v_event_key
        );
      end if;
    end if;

    perform public.safety_stop_campaign_recipient_from_contacted_v2(
      trim(p_contacted_id),
      case when lower(trim(coalesce(p_event_type, ''))) = 'bounce'
        then 'recipient_bounced'
        else 'recipient_replied'
      end
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.lookup_campaign_v2_subject_v2(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_campaigns jsonb;
  v_enrollments jsonb;
  v_sequence_steps jsonb;
  v_recipient_steps jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(ce) order by ce.id), '[]'::jsonb)
  into v_enrollments
  from public.campaign_enrollments ce
  where lower(trim(ce.recipient_email)) = v_email;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)
  into v_campaigns
  from public.campaigns c
  where c.outreach_version = 2
    and exists (
      select 1 from public.campaign_enrollments ce
      where ce.campaign_id = c.id
        and ce.organization_id = c.organization_id
        and ce.user_id = c.user_id
        and lower(trim(ce.recipient_email)) = v_email
    );

  select coalesce(jsonb_agg(to_jsonb(css) order by css.id), '[]'::jsonb)
  into v_sequence_steps
  from public.campaign_sequence_steps_v2 css
  where exists (
    select 1 from public.campaign_enrollments ce
    where ce.sequence_version_id = css.sequence_version_id
      and ce.organization_id = css.organization_id
      and ce.user_id = css.user_id
      and lower(trim(ce.recipient_email)) = v_email
  );

  select coalesce(jsonb_agg(to_jsonb(crs) order by crs.id), '[]'::jsonb)
  into v_recipient_steps
  from public.campaign_recipient_steps crs
  where exists (
    select 1 from public.campaign_enrollments ce
    where ce.id = crs.enrollment_id
      and ce.organization_id = crs.organization_id
      and ce.user_id = crs.user_id
      and lower(trim(ce.recipient_email)) = v_email
  );

  return jsonb_build_object(
    'campaigns', v_campaigns,
    'enrollments', v_enrollments,
    'sequenceSteps', v_sequence_steps,
    'recipientSteps', v_recipient_steps
  );
end;
$$;

alter function public.lookup_research_messaging_subject_v1(text)
  rename to lookup_research_messaging_subject_core_v1;
alter function public.lookup_research_messaging_subject_core_v1(text) stable;

create or replace function public.lookup_research_messaging_subject_v1(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.lookup_research_messaging_subject_core_v1(p_email)
    || jsonb_build_object('campaignV2', public.lookup_campaign_v2_subject_v2(p_email));
$$;

create or replace function public.apply_privacy_suppression_v2(
  p_email text,
  p_reason text default 'privacy_request_block'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_reason text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'privacy_request_block');
  v_updated_contacted integer := 0;
  v_updated_leads integer := 0;
  v_safety_stop jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  -- The durable global suppression is the first write in this transaction.
  insert into public.unsubscribed_emails (email, reason)
  select v_email, v_reason
  where not exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(ue.email)) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  )
  on conflict do nothing;

  v_safety_stop := public.safety_stop_campaign_recipient_v2(v_email, 'recipient_suppressed');

  with updated as (
    update public.contacted_leads
    set campaign_followup_allowed = false,
        campaign_followup_reason = v_reason,
        evaluation_status = 'do_not_contact',
        last_update_at = now()
    where lower(trim(coalesce(email, ''))) = v_email
    returning id
  ) select count(*) into v_updated_contacted from updated;

  with updated as (
    update public.leads
    set status = 'do_not_contact'
    where lower(trim(coalesce(email, ''))) = v_email
    returning id
  ) select count(*) into v_updated_leads from updated;

  return jsonb_build_object(
    'email', v_email,
    'blocked', true,
    'updatedContactedCount', v_updated_contacted,
    'updatedLeadsCount', v_updated_leads,
    'campaignSafetyStop', v_safety_stop
  );
end;
$$;

create or replace function public.delete_campaign_v2_for_retained_native_draft()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.privacy_delete', true), '') = 'on'
    and coalesce(current_setting('app.retention_delete', true), '') <> 'on' then
    delete from public.campaigns c
    using public.campaign_recipient_steps crs
    where crs.campaign_id = c.id
      and crs.native_draft_id = old.id
      and c.outreach_version = 2;
  elsif coalesce(current_setting('app.retention_delete', true), '') = 'on' then
    delete from public.campaigns c
    using public.campaign_recipient_steps crs
    where crs.campaign_id = c.id
      and crs.native_draft_id = old.id
      and c.outreach_version = 2
      and c.v2_status in ('completed', 'stopped', 'blocked');
  end if;
  return old;
end;
$$;

drop trigger if exists delete_campaign_v2_for_retained_native_draft on public.messaging_drafts;
create trigger delete_campaign_v2_for_retained_native_draft
  before delete on public.messaging_drafts
  for each row execute function public.delete_campaign_v2_for_retained_native_draft();

alter function public.delete_native_research_messaging_subject_v1(text)
  rename to delete_native_research_messaging_subject_core_v1;

create or replace function public.delete_native_research_messaging_subject_v1(
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_suppression jsonb;
  v_deleted jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Privacy deletion must take the all-status campaign cascade, even if this
  -- wrapper is called from a transaction that previously ran retention logic.
  perform set_config('app.retention_delete', 'off', true);
  v_suppression := public.apply_privacy_suppression_v2(
    v_email,
    'privacy_request_delete_preserve_block'
  );
  if exists (
    select 1
    from public.outbound_dispatches od
    left join public.messaging_draft_versions mdv on mdv.id = od.version_id
    where od.status = 'sending'
      and lower(trim(coalesce(
        nullif(od.metadata #>> '{recipient,email}', ''),
        nullif(mdv.recipient ->> 'email', ''),
        ''
      ))) = v_email
  ) then
    return jsonb_build_object(
      'outcome', 'pending',
      'blocked', true,
      'reason', 'outbound_dispatch_sending',
      'campaignSafetyStop', v_suppression -> 'campaignSafetyStop'
    );
  end if;
  v_deleted := public.delete_native_research_messaging_subject_core_v1(v_email);
  return v_deleted || jsonb_build_object('campaignSafetyStop', v_suppression -> 'campaignSafetyStop');
end;
$$;

alter function public.delete_research_messaging_retention_v1(
  text, timestamptz, boolean, timestamptz, timestamptz, timestamptz
) rename to delete_research_messaging_retention_core_v1;

create or replace function public.delete_research_messaging_retention_v1(
  p_resource text,
  p_cutoff timestamptz,
  p_dry_run boolean default false,
  p_dispatch_cutoff timestamptz default null,
  p_draft_cutoff timestamptz default null,
  p_job_cutoff timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched integer := 0;
  v_deleted integer := 0;
  v_draft_ids uuid[] := '{}'::uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_cutoff is null then
    raise exception 'cutoff is required' using errcode = '22023';
  end if;
  if p_dry_run and p_resource in ('messaging_drafts', 'research_snapshots')
    and (p_dispatch_cutoff is null or p_draft_cutoff is null or p_job_cutoff is null) then
    raise exception 'dependent retention cutoffs are required for dry run' using errcode = '22023';
  end if;

  -- Retention may use the legacy privacy delete permission for immutable rows,
  -- but Campaign V2 cleanup must remain restricted to terminal campaigns.
  perform set_config('app.privacy_delete', 'off', true);
  perform set_config('app.retention_delete', 'on', true);

  if p_resource <> 'messaging_drafts' then
    return public.delete_research_messaging_retention_core_v1(
      p_resource, p_cutoff, p_dry_run,
      p_dispatch_cutoff, p_draft_cutoff, p_job_cutoff
    );
  end if;

  select coalesce(array_agg(md.id), '{}'::uuid[])
  into v_draft_ids
  from public.messaging_drafts md
  where md.updated_at < p_cutoff
    and not exists (
      select 1 from public.outbound_dispatches od
      where od.draft_id = md.id
        and (not p_dry_run or not (
          od.status in ('sent', 'failed', 'unknown') and od.completed_at < p_dispatch_cutoff
        ))
    )
    and not exists (
      select 1
      from public.campaigns c
      where c.outreach_version = 2
        and c.v2_status in ('draft', 'active')
        and (
          c.initial_native_draft_id = md.id
          or exists (
            select 1 from public.campaign_recipient_steps crs
            where crs.campaign_id = c.id
              and crs.native_draft_id = md.id
          )
        )
    );
  v_matched := coalesce(array_length(v_draft_ids, 1), 0);

  if not p_dry_run then
    update public.messaging_drafts md
    set current_version_id = null
    where md.id = any(v_draft_ids);

    with deleted as (
      delete from public.messaging_drafts md
      where md.id = any(v_draft_ids)
      returning id
    ) select count(*) into v_deleted from deleted;
  end if;

  return jsonb_build_object('matchedCount', v_matched, 'deletedCount', v_deleted);
end;
$$;

create or replace function public.create_first_contact_campaign_plan_v2(
  p_organization_id uuid,
  p_user_id uuid,
  p_draft_id uuid,
  p_version_id uuid,
  p_steps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_draft public.messaging_drafts%rowtype;
  v_version public.messaging_draft_versions%rowtype;
  v_existing_campaign_id uuid;
  v_existing_enrollment_id uuid;
  v_campaign_id uuid := gen_random_uuid();
  v_sequence_version_id uuid := gen_random_uuid();
  v_enrollment_id uuid := gen_random_uuid();
  v_recipient_name text;
  v_recipient_email text;
  v_recipient_lead_ref text;
  v_item jsonb;
  v_ordinality bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organizations o
    where o.id = p_organization_id and o.feature_campaigns_v2_enabled
  ) then
    raise exception 'Campaign V2 is not enabled' using errcode = '42501';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 10 then
    raise exception 'Campaign V2 requires between 1 and 10 follow-up steps' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'campaign-v2-draft:', p_organization_id, ':', p_draft_id
  ), 0));

  select c.id, ce.id into v_existing_campaign_id, v_existing_enrollment_id
  from public.campaigns c
  join public.campaign_enrollments ce on ce.campaign_id = c.id
  where c.organization_id = p_organization_id
    and c.initial_native_draft_id = p_draft_id
    and c.outreach_version = 2
  limit 1;
  if found then
    return jsonb_build_object(
      'created', false,
      'campaignId', v_existing_campaign_id,
      'enrollmentId', v_existing_enrollment_id
    );
  end if;

  if exists (
    select 1
    from public.outbound_dispatches od
    where od.organization_id = p_organization_id
      and od.user_id = p_user_id
      and od.draft_id = p_draft_id
  ) then
    raise exception 'Initial native draft already has an outbound dispatch' using errcode = '55000';
  end if;

  select md.* into v_draft
  from public.messaging_drafts md
  where md.id = p_draft_id
    and md.organization_id = p_organization_id
    and md.user_id = p_user_id
  for update;
  if not found or v_draft.current_version_id <> p_version_id then
    raise exception 'Initial native draft version is missing or not current' using errcode = 'P0002';
  end if;

  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.draft_id = p_draft_id
    and mdv.id = p_version_id
    and mdv.organization_id = p_organization_id
    and mdv.user_id = p_user_id
    and mdv.channel = 'email';
  if not found then
    raise exception 'Initial native email draft was not found' using errcode = 'P0002';
  end if;
  if v_version.research_snapshot_id is null then
    raise exception 'Campaign V2 initial draft requires a research snapshot' using errcode = '23514';
  end if;

  v_recipient_name := nullif(trim(v_version.recipient ->> 'displayName'), '');
  v_recipient_email := lower(trim(coalesce(v_version.recipient ->> 'email', '')));
  v_recipient_lead_ref := nullif(trim(v_version.recipient ->> 'leadRef'), '');
  if v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Initial native draft has no valid recipient email' using errcode = '22023';
  end if;

  for v_item, v_ordinality in
    select item, ordinality from jsonb_array_elements(p_steps) with ordinality as rows(item, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or length(trim(coalesce(v_item ->> 'name', ''))) not between 1 and 120
      or coalesce(v_item ->> 'offsetDays', '') !~ '^[0-9]+$'
      or (v_item ->> 'offsetDays')::integer not between 1 and 365
      or length(trim(coalesce(v_item ->> 'instruction', ''))) not between 1 and 1000 then
      raise exception 'Invalid Campaign V2 follow-up step at position %', v_ordinality using errcode = '22023';
    end if;
  end loop;

  insert into public.campaigns (
    id, user_id, organization_id, name, status, campaign_type,
    outreach_version, v2_status, initial_native_draft_id, settings
  ) values (
    v_campaign_id, p_user_id, p_organization_id,
    concat('Seguimiento a ', coalesce(v_recipient_name, v_recipient_email)),
    'paused', 'follow_up', 2, 'draft', p_draft_id,
    jsonb_build_object('schedulerOwner', 'campaigns-v2', 'delivery', 'explicit_send_only')
  );

  insert into public.campaign_sequence_versions (
    id, campaign_id, organization_id, user_id, version_number, status, content_hash
  ) values (
    v_sequence_version_id, v_campaign_id, p_organization_id, p_user_id, 1, 'published',
    encode(digest(convert_to(p_steps::text, 'UTF8'), 'sha256'), 'hex')
  );

  insert into public.campaign_sequence_steps_v2 (
    sequence_version_id, organization_id, user_id, step_index, name, offset_days, instruction
  ) values (
    v_sequence_version_id, p_organization_id, p_user_id, 0,
    'Contacto inicial', 0, 'Usar el borrador nativo inicial existente.'
  );

  insert into public.campaign_sequence_steps_v2 (
    sequence_version_id, organization_id, user_id, step_index, name, offset_days, instruction
  )
  select
    v_sequence_version_id, p_organization_id, p_user_id, rows.ordinality::integer,
    trim(rows.item ->> 'name'), (rows.item ->> 'offsetDays')::integer,
    trim(rows.item ->> 'instruction')
  from jsonb_array_elements(p_steps) with ordinality as rows(item, ordinality);

  insert into public.campaign_enrollments (
    id, campaign_id, sequence_version_id, organization_id, user_id,
    recipient_name, recipient_email, recipient_lead_ref, research_snapshot_id, status
  ) values (
    v_enrollment_id, v_campaign_id, v_sequence_version_id, p_organization_id, p_user_id,
    v_recipient_name, v_recipient_email, v_recipient_lead_ref, v_version.research_snapshot_id,
    'pending_initial_send'
  );

  insert into public.campaign_recipient_steps (
    enrollment_id, campaign_id, sequence_step_id, organization_id, user_id,
    step_index, state, native_draft_id, native_version_id
  )
  select
    v_enrollment_id, v_campaign_id, css.id, p_organization_id, p_user_id,
    css.step_index,
    case when css.step_index = 0 then 'pending_initial_send' else 'not_due' end,
    case when css.step_index = 0 then p_draft_id else null end,
    case when css.step_index = 0 then p_version_id else null end
  from public.campaign_sequence_steps_v2 css
  where css.sequence_version_id = v_sequence_version_id
  order by css.step_index;

  return jsonb_build_object(
    'created', true,
    'campaignId', v_campaign_id,
    'enrollmentId', v_enrollment_id
  );
end;
$$;

create or replace function public.claim_campaign_recipient_step_prepare_v2(
  p_step_id uuid,
  p_organization_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_instruction text;
  v_unsafe_reason text;
  v_feature_enabled boolean;
  v_claim_token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = p_step_id
    and crs.organization_id = p_organization_id
    and crs.user_id = p_user_id;
  if not found then
    raise exception 'Campaign V2 recipient step was not found for this creator' using errcode = 'P0002';
  end if;

  select o.feature_campaigns_v2_enabled into v_feature_enabled
  from public.organizations o
  where o.id = p_organization_id
  for share;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_step.campaign_id
    and c.organization_id = p_organization_id
    and c.user_id = p_user_id
    and c.outreach_version = 2
  for update;
  if not found then
    raise exception 'Campaign V2 recipient step was not found for this creator' using errcode = 'P0002';
  end if;
  if not coalesce(v_feature_enabled, false) then
    raise exception 'Campaign V2 is not enabled' using errcode = '42501';
  end if;
  if v_campaign.v2_status <> 'active' then
    raise exception 'Campaign V2 campaign is not active' using errcode = '55000';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.id = v_step.enrollment_id
    and ce.campaign_id = v_step.campaign_id
    and ce.organization_id = p_organization_id
    and ce.user_id = p_user_id
  for update;
  if not found or v_enrollment.status <> 'active' then
    raise exception 'Campaign V2 enrollment is not active' using errcode = '55000';
  end if;
  if v_enrollment.research_snapshot_id is null then
    update public.campaign_recipient_steps
    set state = 'blocked',
        preparation_claim_token = null,
        preparation_claimed_at = null,
        last_error = 'research_snapshot_required',
        updated_at = now()
    where enrollment_id = v_enrollment.id
      and state not in ('sent', 'skipped', 'blocked', 'sending', 'unknown');
    update public.campaign_enrollments
    set status = 'blocked', updated_at = now()
    where id = v_enrollment.id;
    update public.campaigns
    set v2_status = 'blocked', updated_at = now()
    where id = v_campaign.id;
    return jsonb_build_object(
      'claimed', false,
      'state', 'blocked',
      'reason', 'research_snapshot_required'
    );
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = p_step_id
    and crs.organization_id = p_organization_id
    and crs.user_id = p_user_id
    and crs.campaign_id = v_campaign.id
    and crs.enrollment_id = v_enrollment.id
  for update;
  if not found then
    raise exception 'Campaign V2 recipient step changed while claiming preparation' using errcode = '40001';
  end if;
  if v_step.native_draft_id is not null then
    return jsonb_build_object(
      'claimed', false, 'state', v_step.state, 'draftId', v_step.native_draft_id,
      'versionId', v_step.native_version_id, 'snapshotId', v_enrollment.research_snapshot_id
    );
  end if;
  if v_step.state = 'drafting'
    and v_step.preparation_claimed_at >= now() - interval '15 minutes' then
    return jsonb_build_object(
      'claimed', false,
      'state', 'drafting',
      'reason', 'draft_preparation_in_progress'
    );
  end if;
  if v_step.state not in ('ready_to_prepare', 'failed', 'drafting') then
    raise exception 'Campaign V2 recipient step is not ready to prepare' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = lower(v_enrollment.recipient_email)
      and ((ue.user_id is null and ue.organization_id is null)
        or ue.user_id = p_user_id or ue.organization_id = p_organization_id)
  ) then
    v_unsafe_reason := 'recipient_suppressed';
  elsif exists (
    select 1 from public.contacted_leads cl
    where cl.organization_id = p_organization_id
      and cl.user_id = p_user_id
      and lower(trim(coalesce(cl.email, ''))) = lower(v_enrollment.recipient_email)
       and (lower(coalesce(cl.evaluation_status, '')) = 'do_not_contact'
        or cl.campaign_followup_allowed is false
        or cl.replied_at is not null or lower(coalesce(cl.status, '')) = 'replied'
        or lower(coalesce(cl.delivery_status, '')) = 'replied'
         or nullif(trim(coalesce(cl.reply_intent, '')), '') is not null
         or nullif(trim(coalesce(cl.last_reply_text, '')), '') is not null)
  ) then
    v_unsafe_reason := 'recipient_replied';
  elsif exists (
    select 1 from public.leads l
    where l.organization_id = p_organization_id
      and l.user_id = p_user_id
      and lower(trim(coalesce(l.email, ''))) = lower(v_enrollment.recipient_email)
      and lower(coalesce(l.status, '')) = 'do_not_contact'
  ) then
    v_unsafe_reason := 'recipient_do_not_contact';
  elsif exists (
    select 1 from public.contacted_leads cl
    where cl.organization_id = p_organization_id
      and cl.user_id = p_user_id
      and lower(trim(coalesce(cl.email, ''))) = lower(v_enrollment.recipient_email)
      and (cl.bounced_at is not null
        or lower(coalesce(cl.delivery_status, '')) in ('soft_bounced', 'hard_bounced', 'bounced')
        or lower(coalesce(cl.lifecycle_state, '')) = 'bounced')
  ) then
    v_unsafe_reason := 'recipient_bounced';
  end if;

  if v_unsafe_reason is not null then
    update public.campaign_recipient_steps
    set state = 'blocked',
        preparation_claim_token = null,
        preparation_claimed_at = null,
        last_error = v_unsafe_reason,
        updated_at = now()
    where enrollment_id = v_enrollment.id
      and state not in ('sent', 'skipped', 'blocked');
    update public.campaign_enrollments
    set status = 'blocked', updated_at = now()
    where id = v_enrollment.id;
    update public.campaigns
    set v2_status = 'blocked', updated_at = now()
    where id = v_step.campaign_id;
    return jsonb_build_object('claimed', false, 'state', 'blocked', 'reason', v_unsafe_reason);
  end if;

  select css.instruction into v_instruction
  from public.campaign_sequence_steps_v2 css
  where css.id = v_step.sequence_step_id;

  update public.campaign_recipient_steps
  set state = 'drafting',
      preparation_claim_token = v_claim_token,
      preparation_claimed_at = now(),
      last_error = null,
      updated_at = now()
  where id = v_step.id;

  return jsonb_build_object(
    'claimed', true,
    'state', 'drafting',
    'claimToken', v_claim_token,
    'snapshotId', v_enrollment.research_snapshot_id,
    'instruction', v_instruction,
    'recipientEmail', v_enrollment.recipient_email
  );
end;
$$;

create or replace function public.stop_campaign_enrollment_v2(
  p_campaign_id uuid,
  p_enrollment_id uuid,
  p_organization_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_feature_enabled boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select o.feature_campaigns_v2_enabled into v_feature_enabled
  from public.organizations o
  where o.id = p_organization_id
  for share;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = p_campaign_id
    and c.organization_id = p_organization_id
    and c.user_id = p_user_id
    and c.outreach_version = 2
  for update;
  if not found then
    raise exception 'Campaign V2 was not found for this creator' using errcode = 'P0002';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where id = p_enrollment_id
    and campaign_id = p_campaign_id
    and organization_id = p_organization_id
    and user_id = p_user_id
  for update;
  if not found then
    raise exception 'Campaign V2 enrollment was not found' using errcode = 'P0002';
  end if;
  if v_enrollment.status = 'stopped' then
    return jsonb_build_object(
      'id', v_enrollment.id,
      'campaignId', v_enrollment.campaign_id,
      'status', 'stopped',
      'stoppedAt', v_enrollment.stopped_at,
      'recipientName', v_enrollment.recipient_name,
      'recipientEmail', v_enrollment.recipient_email,
      'replayed', true
    );
  end if;
  if v_enrollment.status in ('completed', 'blocked') then
    raise exception 'Completed or blocked Campaign V2 enrollments cannot be manually stopped' using errcode = '55000';
  end if;
  if v_enrollment.status not in ('pending_initial_send', 'active')
    or v_campaign.v2_status not in ('draft', 'active') then
    raise exception 'Campaign V2 enrollment is not manually stoppable' using errcode = '55000';
  end if;
  if not coalesce(v_feature_enabled, false) then
    raise exception 'Campaign V2 is not enabled' using errcode = '42501';
  end if;

  perform 1
  from public.campaign_recipient_steps crs
  where crs.enrollment_id = p_enrollment_id
  order by crs.step_index
  for update;

  update public.campaign_enrollments
  set status = 'stopped', stopped_at = coalesce(stopped_at, now()), updated_at = now()
  where id = p_enrollment_id
    and status in ('pending_initial_send', 'active')
  returning * into v_enrollment;
  if not found then
    raise exception 'Campaign V2 enrollment changed while stopping' using errcode = '40001';
  end if;

  update public.campaign_recipient_steps
  set state = 'skipped',
      preparation_claim_token = null,
      preparation_claimed_at = null,
      updated_at = now()
  where enrollment_id = p_enrollment_id
    and state not in ('sent', 'skipped', 'blocked', 'sending', 'unknown')
    and (
      outbound_dispatch_id is null
      or exists (
        select 1 from public.outbound_dispatches od
        where od.id = campaign_recipient_steps.outbound_dispatch_id
          and od.status in ('pending', 'deferred', 'failed')
      )
    );
  update public.campaigns
  set v2_status = 'stopped', v2_stopped_at = coalesce(v2_stopped_at, now()), updated_at = now()
  where id = p_campaign_id
    and v2_status in ('draft', 'active');
  if not found then
    raise exception 'Campaign V2 campaign changed while stopping' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'id', v_enrollment.id,
    'campaignId', v_enrollment.campaign_id,
    'status', 'stopped',
    'stoppedAt', v_enrollment.stopped_at,
    'recipientName', v_enrollment.recipient_name,
    'recipientEmail', v_enrollment.recipient_email
  );
end;
$$;

create or replace function public.promote_due_campaign_recipient_steps_v2(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate record;
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_promoted integer := 0;
  v_blocked integer := 0;
  v_unsafe_reason text;
  v_feature_enabled boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid Campaign V2 promotion limit' using errcode = '22023';
  end if;

  for v_candidate in
    select crs.id, crs.enrollment_id, crs.organization_id, crs.user_id,
      ce.recipient_email, crs.campaign_id
    from public.campaign_recipient_steps crs
    join public.campaign_enrollments ce on ce.id = crs.enrollment_id and ce.status = 'active'
    join public.campaigns c on c.id = crs.campaign_id
      and c.outreach_version = 2 and c.v2_status = 'active'
    join public.organizations o on o.id = crs.organization_id and o.feature_campaigns_v2_enabled
    join public.campaign_recipient_steps previous_step
      on previous_step.enrollment_id = crs.enrollment_id
      and previous_step.step_index = crs.step_index - 1
      and previous_step.state = 'sent'
      and previous_step.sent_at is not null
    where crs.state = 'not_due'
      and crs.due_at is not null
      and crs.due_at <= now()
    order by crs.due_at, crs.id
    limit p_limit
  loop
    select o.feature_campaigns_v2_enabled into v_feature_enabled
    from public.organizations o
    where o.id = v_candidate.organization_id
    for share;

    select c.* into v_campaign
    from public.campaigns c
    where c.id = v_candidate.campaign_id
      and c.organization_id = v_candidate.organization_id
      and c.user_id = v_candidate.user_id
      and c.outreach_version = 2
      and c.v2_status = 'active'
    for update;
    if not found or not coalesce(v_feature_enabled, false) then
      continue;
    end if;

    select ce.* into v_enrollment
    from public.campaign_enrollments ce
    where ce.id = v_candidate.enrollment_id
      and ce.campaign_id = v_candidate.campaign_id
      and ce.organization_id = v_candidate.organization_id
      and ce.user_id = v_candidate.user_id
      and ce.status = 'active'
    for update;
    if not found then
      continue;
    end if;

    select crs.* into v_step
    from public.campaign_recipient_steps crs
    where crs.id = v_candidate.id
      and crs.enrollment_id = v_candidate.enrollment_id
      and crs.state = 'not_due'
      and crs.due_at is not null
      and crs.due_at <= now()
      and exists (
        select 1
        from public.campaign_recipient_steps previous_step
        where previous_step.enrollment_id = crs.enrollment_id
          and previous_step.step_index = crs.step_index - 1
          and previous_step.state = 'sent'
          and previous_step.sent_at is not null
      )
    for update;
    if not found then
      continue;
    end if;

    v_unsafe_reason := null;
    if exists (
      select 1 from public.unsubscribed_emails ue
      where lower(trim(coalesce(ue.email, ''))) = lower(v_candidate.recipient_email)
        and ((ue.user_id is null and ue.organization_id is null)
          or ue.user_id = v_candidate.user_id or ue.organization_id = v_candidate.organization_id)
    ) then
      v_unsafe_reason := 'recipient_suppressed';
    elsif exists (
      select 1 from public.contacted_leads cl
      where cl.organization_id = v_candidate.organization_id
        and cl.user_id = v_candidate.user_id
      and lower(trim(coalesce(cl.email, ''))) = lower(v_candidate.recipient_email)
      and (lower(coalesce(cl.evaluation_status, '')) = 'do_not_contact'
          or cl.campaign_followup_allowed is false
          or cl.replied_at is not null or lower(coalesce(cl.status, '')) = 'replied'
          or lower(coalesce(cl.delivery_status, '')) = 'replied'
          or nullif(trim(coalesce(cl.reply_intent, '')), '') is not null
          or nullif(trim(coalesce(cl.last_reply_text, '')), '') is not null)
    ) then
      v_unsafe_reason := 'recipient_replied';
    elsif exists (
      select 1 from public.leads l
      where l.organization_id = v_candidate.organization_id
        and l.user_id = v_candidate.user_id
        and lower(trim(coalesce(l.email, ''))) = lower(v_candidate.recipient_email)
        and lower(coalesce(l.status, '')) = 'do_not_contact'
    ) then
      v_unsafe_reason := 'recipient_do_not_contact';
    elsif exists (
      select 1 from public.contacted_leads cl
      where cl.organization_id = v_candidate.organization_id
        and cl.user_id = v_candidate.user_id
        and lower(trim(coalesce(cl.email, ''))) = lower(v_candidate.recipient_email)
        and (cl.bounced_at is not null
          or lower(coalesce(cl.delivery_status, '')) in ('soft_bounced', 'hard_bounced', 'bounced')
          or lower(coalesce(cl.lifecycle_state, '')) = 'bounced')
    ) then
      v_unsafe_reason := 'recipient_bounced';
    end if;

    if v_unsafe_reason is not null then
      update public.campaign_recipient_steps
      set state = 'blocked',
          preparation_claim_token = null,
          preparation_claimed_at = null,
          last_error = v_unsafe_reason,
          updated_at = now()
      where enrollment_id = v_candidate.enrollment_id
        and state not in ('sent', 'skipped', 'blocked');
      update public.campaign_enrollments
      set status = 'blocked', updated_at = now()
      where id = v_candidate.enrollment_id;
      update public.campaigns
      set v2_status = 'blocked', updated_at = now()
      where id = v_candidate.campaign_id;
      v_blocked := v_blocked + 1;
    else
      update public.campaign_recipient_steps
      set state = 'ready_to_prepare', last_error = null, updated_at = now()
      where id = v_candidate.id and state = 'not_due';
      if found then v_promoted := v_promoted + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('promoted', v_promoted, 'blocked', v_blocked);
end;
$$;

create or replace function public.finalize_campaign_recipient_step_dispatch_v2(
  p_dispatch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.outbound_dispatches%rowtype;
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_next public.campaign_recipient_steps%rowtype;
  v_next_offset integer;
  v_sent_at timestamptz;
  v_contacted_id text;
  v_target_state text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select od.* into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
  for update;
  if not found then
    return jsonb_build_object('matched', false, 'reason', 'dispatch_missing');
  end if;
  if v_dispatch.campaign_recipient_step_id is null then
    return jsonb_build_object('matched', false, 'reason', 'not_campaign_v2');
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = v_dispatch.campaign_recipient_step_id
    and crs.organization_id = v_dispatch.organization_id
    and crs.user_id = v_dispatch.user_id
    and crs.native_draft_id = v_dispatch.draft_id
    and crs.native_version_id = v_dispatch.version_id
    and crs.outbound_dispatch_id = v_dispatch.id;
  if not found then
    raise exception 'Campaign V2 dispatch does not match its claimed recipient step' using errcode = '55000';
  end if;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_step.campaign_id
    and c.organization_id = v_step.organization_id
    and c.user_id = v_step.user_id
    and c.outreach_version = 2
  for update;
  if not found then
    raise exception 'Campaign V2 dispatch campaign identity is invalid' using errcode = '55000';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.id = v_step.enrollment_id
    and ce.campaign_id = v_step.campaign_id
    and ce.organization_id = v_step.organization_id
    and ce.user_id = v_step.user_id
  for update;
  if not found then
    raise exception 'Campaign V2 dispatch enrollment identity is invalid' using errcode = '55000';
  end if;

  perform 1
  from public.campaign_recipient_steps crs
  where crs.enrollment_id = v_step.enrollment_id
  order by crs.step_index
  for update;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = v_dispatch.campaign_recipient_step_id
    and crs.outbound_dispatch_id = v_dispatch.id;
  if not found then
    raise exception 'Campaign V2 dispatch claim changed during finalization' using errcode = '40001';
  end if;

  if v_dispatch.campaign_recipient_step_id is distinct from v_step.id
    or v_dispatch.organization_id is distinct from v_step.organization_id
    or v_dispatch.user_id is distinct from v_step.user_id
    or v_dispatch.draft_id is distinct from v_step.native_draft_id
    or v_dispatch.version_id is distinct from v_step.native_version_id then
    raise exception 'Campaign V2 dispatch identity changed during finalization' using errcode = '40001';
  end if;

  v_target_state := case v_dispatch.status
    when 'pending' then 'dispatch_pending'
    when 'sending' then 'sending'
    when 'sent' then 'sent'
    when 'deferred' then 'deferred'
    when 'failed' then 'failed'
    else 'unknown'
  end;

  if v_dispatch.status <> 'sent' then
    if v_step.state in ('sent', 'skipped', 'blocked') then
      return jsonb_build_object(
        'matched', true,
        'state', v_step.state,
        'replayed', true,
        'preservedTerminalState', true
      );
    end if;
    update public.campaign_recipient_steps
    set state = v_target_state,
        preparation_claim_token = null,
        preparation_claimed_at = null,
        last_error = case when v_dispatch.status in ('failed', 'deferred', 'unknown')
          then coalesce(v_dispatch.error_message, v_dispatch.error_code) else null end,
        updated_at = now()
    where id = v_step.id
      and outbound_dispatch_id = v_dispatch.id
      and state not in ('sent', 'skipped', 'blocked');
    return jsonb_build_object('matched', true, 'state', v_target_state, 'replayed', false);
  end if;

  v_sent_at := coalesce(v_dispatch.completed_at, v_dispatch.reconciled_at, v_dispatch.requested_at, now());
  select cl.id into v_contacted_id
  from public.contacted_leads cl
  where cl.organization_id = v_dispatch.organization_id
    and cl.user_id = v_dispatch.user_id
    and cl.data @> jsonb_build_object('dispatchId', v_dispatch.id::text)
  order by cl.created_at asc
  limit 1;
  if v_contacted_id is null then
    if exists (
      select 1 from public.unsubscribed_emails ue
      where lower(trim(coalesce(ue.email, ''))) = lower(v_enrollment.recipient_email)
        and ((ue.user_id is null and ue.organization_id is null)
          or ue.user_id = v_dispatch.user_id
          or ue.organization_id = v_dispatch.organization_id)
    ) then
      update public.campaign_recipient_steps
      set state = 'sent', sent_at = v_sent_at, contacted_id = null,
          preparation_claim_token = null, preparation_claimed_at = null,
          last_error = 'sent_before_recipient_suppression', updated_at = now()
      where id = v_step.id
        and outbound_dispatch_id = v_dispatch.id;
      update public.campaign_recipient_steps
      set state = 'blocked', last_error = 'recipient_suppressed', updated_at = now()
      where enrollment_id = v_step.enrollment_id
        and id <> v_step.id
        and state not in ('sent', 'skipped', 'blocked');
      update public.campaign_enrollments
      set status = 'blocked', updated_at = now()
      where id = v_step.enrollment_id;
      update public.campaigns
      set v2_status = 'blocked', updated_at = now()
      where id = v_step.campaign_id;
      return jsonb_build_object(
        'matched', true, 'state', 'sent', 'replayed', false,
        'contactedId', null, 'sentAt', v_sent_at, 'recipientSuppressed', true
      );
    end if;
    raise exception 'Campaign V2 sent dispatch history projection is incomplete' using errcode = '55000';
  end if;

  if v_step.state in ('skipped', 'blocked') then
    return jsonb_build_object(
      'matched', true,
      'state', v_step.state,
      'replayed', true,
      'preservedTerminalState', true,
      'contactedId', v_contacted_id
    );
  end if;
  if v_step.state = 'sent' then
    update public.campaign_recipient_steps
    set contacted_id = coalesce(contacted_id, v_contacted_id), updated_at = now()
    where id = v_step.id
      and outbound_dispatch_id = v_dispatch.id
      and contacted_id is null
      and v_contacted_id is not null;
    return jsonb_build_object('matched', true, 'state', 'sent', 'replayed', true, 'contactedId', v_contacted_id);
  end if;

  update public.campaign_recipient_steps
  set state = 'sent', contacted_id = v_contacted_id,
      preparation_claim_token = null, preparation_claimed_at = null,
      sent_at = v_sent_at, last_error = null, updated_at = now()
  where id = v_step.id
    and outbound_dispatch_id = v_dispatch.id
    and state not in ('sent', 'skipped', 'blocked');
  if not found then
    raise exception 'Campaign V2 recipient step changed during sent finalization' using errcode = '40001';
  end if;

  if v_step.step_index = 0 then
    update public.campaign_enrollments
    set status = 'active', initial_sent_at = coalesce(initial_sent_at, v_sent_at), updated_at = now()
    where id = v_step.enrollment_id and status = 'pending_initial_send';
    update public.campaigns
    set v2_status = 'active', v2_activated_at = coalesce(v2_activated_at, v_sent_at), updated_at = now()
    where id = v_step.campaign_id and v2_status = 'draft';
  end if;

  select crs.* into v_next
  from public.campaign_recipient_steps crs
  where crs.enrollment_id = v_step.enrollment_id
    and crs.step_index = v_step.step_index + 1;

  if found then
    select css.offset_days into v_next_offset
    from public.campaign_sequence_steps_v2 css
    where css.id = v_next.sequence_step_id;
    update public.campaign_recipient_steps
    set due_at = v_sent_at + make_interval(days => v_next_offset),
        state = case when v_next_offset = 0 then 'ready_to_prepare' else 'not_due' end,
        last_error = null,
        updated_at = now()
    where id = v_next.id and state = 'not_due' and due_at is null;
  else
    update public.campaign_enrollments
    set status = 'completed', completed_at = coalesce(completed_at, v_sent_at), updated_at = now()
    where id = v_step.enrollment_id and status in ('active', 'pending_initial_send');
    update public.campaigns
    set v2_status = 'completed', updated_at = now()
    where id = v_step.campaign_id and v2_status in ('active', 'draft');
  end if;

  return jsonb_build_object(
    'matched', true, 'state', 'sent', 'replayed', false,
    'contactedId', v_contacted_id, 'sentAt', v_sent_at
  );
end;
$$;

-- The existing history projection marks history_repair_status complete. Wrap it
-- so that status represents both sent history and Campaign V2 projection health.
alter function public.finalize_sent_outbound_dispatch_history_v1(uuid)
  rename to finalize_sent_outbound_dispatch_history_core_v1;

create or replace function public.finalize_sent_outbound_dispatch_history_v1(
  p_dispatch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_history jsonb;
  v_campaign_v2 jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_history := public.finalize_sent_outbound_dispatch_history_core_v1(p_dispatch_id);
  if coalesce((v_history ->> 'finalized')::boolean, false) then
    v_campaign_v2 := public.finalize_campaign_recipient_step_dispatch_v2(p_dispatch_id);
  end if;

  return v_history || jsonb_build_object('campaignV2', coalesce(v_campaign_v2, 'null'::jsonb));
end;
$$;

revoke all on function public.finalize_sent_outbound_dispatch_history_core_v1(uuid) from public, anon, authenticated;
revoke all on function public.finalize_sent_outbound_dispatch_history_v1(uuid) from public, anon, authenticated;
grant execute on function public.finalize_sent_outbound_dispatch_history_core_v1(uuid) to service_role;
grant execute on function public.finalize_sent_outbound_dispatch_history_v1(uuid) to service_role;

alter table public.campaign_sequence_versions enable row level security;
alter table public.campaign_sequence_steps_v2 enable row level security;
alter table public.campaign_enrollments enable row level security;
alter table public.campaign_recipient_steps enable row level security;

revoke all on table public.campaign_sequence_versions from anon, authenticated;
revoke all on table public.campaign_sequence_steps_v2 from anon, authenticated;
revoke all on table public.campaign_enrollments from anon, authenticated;
revoke all on table public.campaign_recipient_steps from anon, authenticated;
grant select on table public.campaign_sequence_versions to authenticated;
grant select on table public.campaign_sequence_steps_v2 to authenticated;
grant select on table public.campaign_enrollments to authenticated;
grant select on table public.campaign_recipient_steps to authenticated;
grant all on table public.campaign_sequence_versions to service_role;
grant all on table public.campaign_sequence_steps_v2 to service_role;
grant all on table public.campaign_enrollments to service_role;
grant all on table public.campaign_recipient_steps to service_role;

create policy "Organization members can read Campaign V2 sequence versions"
  on public.campaign_sequence_versions for select to authenticated
  using (exists (
    select 1 from public.organization_members om
    where om.organization_id = campaign_sequence_versions.organization_id
      and om.user_id = (select auth.uid())
  ));
create policy "Organization members can read Campaign V2 sequence steps"
  on public.campaign_sequence_steps_v2 for select to authenticated
  using (exists (
    select 1 from public.organization_members om
    where om.organization_id = campaign_sequence_steps_v2.organization_id
      and om.user_id = (select auth.uid())
  ));
create policy "Organization members can read Campaign V2 enrollments"
  on public.campaign_enrollments for select to authenticated
  using (exists (
    select 1 from public.organization_members om
    where om.organization_id = campaign_enrollments.organization_id
      and om.user_id = (select auth.uid())
  ));
create policy "Organization members can read Campaign V2 recipient steps"
  on public.campaign_recipient_steps for select to authenticated
  using (exists (
    select 1 from public.organization_members om
    where om.organization_id = campaign_recipient_steps.organization_id
      and om.user_id = (select auth.uid())
  ));

revoke all on function public.create_first_contact_campaign_plan_v2(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_outbound_dispatch_sending_v2(uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.claim_campaign_recipient_step_prepare_v2(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.stop_campaign_enrollment_v2(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.promote_due_campaign_recipient_steps_v2(integer) from public, anon, authenticated;
revoke all on function public.finalize_campaign_recipient_step_dispatch_v2(uuid) from public, anon, authenticated;
revoke all on function public.safety_stop_campaign_recipient_v2(text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.safety_stop_campaign_recipient_from_contacted_v2(text, text) from public, anon, authenticated;
revoke all on function public.record_scoped_unsubscribe_v2(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.lookup_campaign_v2_subject_v2(text) from public, anon, authenticated;
revoke all on function public.lookup_research_messaging_subject_core_v1(text) from public, anon, authenticated;
revoke all on function public.lookup_research_messaging_subject_v1(text) from public, anon, authenticated;
revoke all on function public.lock_unsubscribed_email_privacy_v2() from public, anon, authenticated;
revoke all on function public.lock_contacted_lead_campaign_safety_v2() from public, anon, authenticated;
revoke all on function public.lock_lead_campaign_safety_v2() from public, anon, authenticated;
revoke all on function public.assign_campaign_recipient_step_inbox_order_v2() from public, anon, authenticated;
revoke all on function public.apply_privacy_suppression_v2(text, text) from public, anon, authenticated;
revoke all on function public.delete_native_research_messaging_subject_core_v1(text) from public, anon, authenticated, service_role;
revoke all on function public.delete_native_research_messaging_subject_v1(text) from public, anon, authenticated;
revoke all on function public.delete_research_messaging_subject_v1(text) from public, anon, authenticated, service_role;
revoke all on function public.delete_research_messaging_retention_core_v1(text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.delete_research_messaging_retention_v1(text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ingest_inbound_reply_core_v1(
  text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.ingest_inbound_reply_v1(
  text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_first_contact_campaign_plan_v2(uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.claim_outbound_dispatch_sending_v2(uuid, timestamptz, integer) to service_role;
grant execute on function public.claim_campaign_recipient_step_prepare_v2(uuid, uuid, uuid) to service_role;
grant execute on function public.stop_campaign_enrollment_v2(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.promote_due_campaign_recipient_steps_v2(integer) to service_role;
grant execute on function public.finalize_campaign_recipient_step_dispatch_v2(uuid) to service_role;
grant execute on function public.safety_stop_campaign_recipient_v2(text, text, uuid, uuid) to service_role;
grant execute on function public.safety_stop_campaign_recipient_from_contacted_v2(text, text) to service_role;
grant execute on function public.record_scoped_unsubscribe_v2(text, uuid, uuid, text) to service_role;
grant execute on function public.lookup_campaign_v2_subject_v2(text) to service_role;
grant execute on function public.lookup_research_messaging_subject_core_v1(text) to service_role;
grant execute on function public.lookup_research_messaging_subject_v1(text) to service_role;
grant execute on function public.apply_privacy_suppression_v2(text, text) to service_role;
grant execute on function public.delete_native_research_messaging_subject_v1(text) to service_role;
grant execute on function public.delete_research_messaging_retention_v1(text, timestamptz, boolean, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.ingest_inbound_reply_v1(
  text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
