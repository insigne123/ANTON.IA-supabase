-- Pre-generate personal follow-up drafts while keeping every send and approval
-- explicit. This migration is additive to the Campaign Outreach V2 canary.

alter table public.campaign_recipient_steps
  add column if not exists reserved_native_draft_id uuid,
  add column if not exists reserved_native_version_id uuid;

alter table public.campaign_recipient_steps
  drop constraint if exists campaign_recipient_steps_reserved_draft_pair_check;
alter table public.campaign_recipient_steps
  add constraint campaign_recipient_steps_reserved_draft_pair_check check (
    (reserved_native_draft_id is null and reserved_native_version_id is null)
    or (reserved_native_draft_id is not null and reserved_native_version_id is not null)
  );

create unique index if not exists campaign_recipient_steps_reserved_draft_uidx
  on public.campaign_recipient_steps (organization_id, reserved_native_draft_id)
  where reserved_native_draft_id is not null;

create table if not exists public.campaign_v2_draft_reservations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null,
  enrollment_id uuid not null,
  recipient_step_id uuid not null,
  draft_id uuid not null,
  version_id uuid not null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, draft_id),
  unique (organization_id, recipient_step_id)
);

alter table public.campaign_v2_draft_reservations enable row level security;
revoke all on table public.campaign_v2_draft_reservations from public, anon, authenticated;
grant all on table public.campaign_v2_draft_reservations to service_role;
create index if not exists campaign_v2_draft_reservations_user_idx
  on public.campaign_v2_draft_reservations (user_id);

update public.campaigns
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
      'followUpDrafting', jsonb_build_object(
        'sequenceInstruction', 'Haz avanzar la conversación de forma breve y útil, sin repetir los correos anteriores.',
        'styleProfileId', null
      )
    ),
    updated_at = now()
where outreach_version = 2
  and coalesce(settings, '{}'::jsonb) -> 'followUpDrafting' is null;

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
              and (
                crs.native_draft_id = md.id
                or crs.reserved_native_draft_id = md.id
              )
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
  p_style_profile_id uuid,
  p_sequence_instruction text,
  p_steps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_sequence_instruction, ''))) not between 1 and 1000 then
    raise exception 'Campaign V2 sequence instruction is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 4 then
    raise exception 'Campaign V2 requires between 1 and 4 follow-up steps' using errcode = '22023';
  end if;
  if p_style_profile_id is not null and not exists (
    select 1
    from public.email_style_profiles esp
    where esp.id = p_style_profile_id
      and esp.organization_id = p_organization_id
      and esp.user_id = p_user_id
  ) then
    raise exception 'Campaign V2 style profile was not found for this creator' using errcode = 'P0002';
  end if;

  -- The original RPC retains all draft, recipient, feature, and dispatch fencing.
  -- Calling it here keeps plan creation and drafting config in one transaction.
  v_result := public.create_first_contact_campaign_plan_v2(
    p_organization_id,
    p_user_id,
    p_draft_id,
    p_version_id,
    p_steps
  );

  update public.campaigns
  set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
        'followUpDrafting', jsonb_build_object(
          'sequenceInstruction', trim(p_sequence_instruction),
          'styleProfileId', to_jsonb(p_style_profile_id)
        )
      ),
      updated_at = now()
  where id = (v_result ->> 'campaignId')::uuid
    and organization_id = p_organization_id
    and user_id = p_user_id
    and outreach_version = 2
    and (
      coalesce((v_result ->> 'created')::boolean, false)
      or coalesce(settings, '{}'::jsonb) -> 'followUpDrafting' is null
    );
  if coalesce((v_result ->> 'created')::boolean, false) and not found then
    raise exception 'Campaign V2 drafting config could not be persisted' using errcode = '40001';
  end if;

  return v_result;
end;
$$;

create or replace function public.reserve_campaign_recipient_step_draft_v2(
  p_step_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_draft_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.campaign_recipient_steps%rowtype;
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_feature_enabled boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_step_id is null or p_organization_id is null or p_user_id is null
    or p_draft_id is null or p_version_id is null then
    raise exception 'Campaign V2 draft reservation identity is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'campaign-v2-draft:', p_organization_id, ':', p_draft_id
  ), 0));

  select crs.* into v_candidate
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
  if not coalesce(v_feature_enabled, false) then
    raise exception 'Campaign V2 is not enabled' using errcode = '42501';
  end if;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_candidate.campaign_id
    and c.organization_id = p_organization_id
    and c.user_id = p_user_id
    and c.outreach_version = 2
  for update;
  if not found or v_campaign.v2_status <> 'draft' then
    raise exception 'Campaign V2 campaign is not eligible for draft pre-generation' using errcode = '55000';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.id = v_candidate.enrollment_id
    and ce.campaign_id = v_campaign.id
    and ce.organization_id = p_organization_id
    and ce.user_id = p_user_id
  for update;
  if not found or v_enrollment.status <> 'pending_initial_send' then
    raise exception 'Campaign V2 enrollment is not eligible for draft pre-generation' using errcode = '55000';
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = p_step_id
    and crs.campaign_id = v_campaign.id
    and crs.enrollment_id = v_enrollment.id
    and crs.organization_id = p_organization_id
    and crs.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Campaign V2 recipient step changed while reserving its draft' using errcode = '40001';
  end if;
  if v_step.reserved_native_draft_id = p_draft_id
    and v_step.reserved_native_version_id = p_version_id then
    if not exists (
      select 1
      from public.campaign_v2_draft_reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.user_id = p_user_id
        and reservation.campaign_id = v_campaign.id
        and reservation.enrollment_id = v_enrollment.id
        and reservation.recipient_step_id = v_step.id
        and reservation.draft_id = p_draft_id
        and reservation.version_id = p_version_id
    ) then
      raise exception 'Campaign V2 durable draft reservation is missing' using errcode = '23514';
    end if;
    return jsonb_build_object(
      'reserved', false,
      'stepId', v_step.id,
      'draftId', v_step.reserved_native_draft_id,
      'versionId', v_step.reserved_native_version_id
    );
  end if;
  if v_step.step_index <= 0
    or v_step.state <> 'not_due'
    or v_step.due_at is not null
    or v_step.native_draft_id is not null
    or v_step.native_version_id is not null
    or v_step.reserved_native_draft_id is not null
    or v_step.reserved_native_version_id is not null
    or v_step.outbound_dispatch_id is not null then
    raise exception 'Campaign V2 recipient step is not eligible for draft reservation' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.campaign_sequence_steps_v2 css
    where css.id = v_step.sequence_step_id
      and css.sequence_version_id = v_enrollment.sequence_version_id
      and css.organization_id = p_organization_id
      and css.user_id = p_user_id
  ) then
    raise exception 'Campaign V2 recipient step is outside the enrolled sequence' using errcode = '23514';
  end if;

  update public.campaign_recipient_steps
  set reserved_native_draft_id = p_draft_id,
      reserved_native_version_id = p_version_id,
      last_error = null,
      updated_at = now()
  where id = v_step.id
    and state = 'not_due'
    and due_at is null
    and native_draft_id is null
    and native_version_id is null
    and reserved_native_draft_id is null
    and reserved_native_version_id is null
    and outbound_dispatch_id is null
  returning * into v_step;
  if not found then
    raise exception 'Campaign V2 recipient step draft reservation was lost' using errcode = '40001';
  end if;

  insert into public.campaign_v2_draft_reservations (
    organization_id, user_id, campaign_id, enrollment_id,
    recipient_step_id, draft_id, version_id
  ) values (
    p_organization_id, p_user_id, v_campaign.id, v_enrollment.id,
    v_step.id, p_draft_id, p_version_id
  );

  return jsonb_build_object(
    'reserved', true,
    'stepId', v_step.id,
    'draftId', v_step.reserved_native_draft_id,
    'versionId', v_step.reserved_native_version_id
  );
end;
$$;

create or replace function public.link_campaign_recipient_step_draft_v2(
  p_step_id uuid,
  p_organization_id uuid,
  p_user_id uuid,
  p_draft_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.campaign_recipient_steps%rowtype;
  v_step public.campaign_recipient_steps%rowtype;
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_draft public.messaging_drafts%rowtype;
  v_version public.messaging_draft_versions%rowtype;
  v_feature_enabled boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_step_id is null or p_organization_id is null or p_user_id is null
    or p_draft_id is null or p_version_id is null then
    raise exception 'Campaign V2 draft link identity is required' using errcode = '22023';
  end if;

  select crs.* into v_candidate
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
  if not coalesce(v_feature_enabled, false) then
    raise exception 'Campaign V2 is not enabled' using errcode = '42501';
  end if;

  -- Draft revisions acquire the draft before their sync trigger touches a step.
  -- Preserve that lock order so linking cannot deadlock a concurrent revision.
  select md.* into v_draft
  from public.messaging_drafts md
  where md.id = p_draft_id
    and md.organization_id = p_organization_id
    and md.user_id = p_user_id
  for share;
  if not found
    or v_draft.current_version_id is distinct from p_version_id
    or v_draft.channel <> 'email' then
    raise exception 'Campaign V2 native draft is not current for this creator' using errcode = '55000';
  end if;

  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.draft_id = p_draft_id
    and mdv.id = p_version_id
    and mdv.organization_id = p_organization_id
    and mdv.user_id = p_user_id
    and mdv.channel = 'email';
  if not found then
    raise exception 'Campaign V2 native draft version was not found for this creator' using errcode = 'P0002';
  end if;

  select c.* into v_campaign
  from public.campaigns c
  where c.id = v_candidate.campaign_id
    and c.organization_id = p_organization_id
    and c.user_id = p_user_id
    and c.outreach_version = 2
  for update;
  if not found or v_campaign.v2_status <> 'draft' then
    raise exception 'Campaign V2 campaign is not eligible for draft pre-generation' using errcode = '55000';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.id = v_candidate.enrollment_id
    and ce.campaign_id = v_campaign.id
    and ce.organization_id = p_organization_id
    and ce.user_id = p_user_id
  for update;
  if not found or v_enrollment.status <> 'pending_initial_send' then
    raise exception 'Campaign V2 enrollment is not eligible for draft pre-generation' using errcode = '55000';
  end if;

  select crs.* into v_step
  from public.campaign_recipient_steps crs
  where crs.id = p_step_id
    and crs.campaign_id = v_campaign.id
    and crs.enrollment_id = v_enrollment.id
    and crs.organization_id = p_organization_id
    and crs.user_id = p_user_id
  for update;
  if not found then
    raise exception 'Campaign V2 recipient step changed while linking its draft' using errcode = '40001';
  end if;
  if v_step.reserved_native_draft_id is distinct from p_draft_id
    or v_step.reserved_native_version_id is distinct from p_version_id then
    raise exception 'Campaign V2 native draft does not match its reservation' using errcode = '23514';
  end if;
  if v_step.native_draft_id = p_draft_id and v_step.native_version_id = p_version_id then
    update public.campaign_v2_draft_reservations
    set linked_at = coalesce(linked_at, now())
    where organization_id = p_organization_id
      and user_id = p_user_id
      and campaign_id = v_campaign.id
      and enrollment_id = v_enrollment.id
      and recipient_step_id = v_step.id
      and draft_id = p_draft_id
      and version_id = p_version_id;
    if not found then
      raise exception 'Campaign V2 durable draft reservation is missing' using errcode = '23514';
    end if;
    return jsonb_build_object(
      'linked', false,
      'stepId', v_step.id,
      'draftId', v_step.native_draft_id,
      'versionId', v_step.native_version_id,
      'state', v_step.state
    );
  end if;
  if v_step.step_index <= 0
    or v_step.state <> 'not_due'
    or v_step.due_at is not null
    or v_step.native_draft_id is not null
    or v_step.native_version_id is not null
    or v_step.outbound_dispatch_id is not null then
    raise exception 'Campaign V2 recipient step is not eligible for draft pre-generation' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.campaign_sequence_steps_v2 css
    where css.id = v_step.sequence_step_id
      and css.sequence_version_id = v_enrollment.sequence_version_id
      and css.organization_id = p_organization_id
      and css.user_id = p_user_id
  ) then
    raise exception 'Campaign V2 recipient step is outside the enrolled sequence' using errcode = '23514';
  end if;
  if v_draft.research_snapshot_id is distinct from v_enrollment.research_snapshot_id
    or v_version.research_snapshot_id is distinct from v_enrollment.research_snapshot_id
    or lower(trim(coalesce(v_version.recipient ->> 'email', '')))
      <> lower(trim(v_enrollment.recipient_email)) then
    raise exception 'Campaign V2 native draft does not match the enrolled recipient context' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.campaign_recipient_steps crs
    where crs.organization_id = p_organization_id
      and crs.native_draft_id = p_draft_id
      and crs.id <> v_step.id
  ) then
    raise exception 'Campaign V2 native draft is already linked to another step' using errcode = '23505';
  end if;

  update public.campaign_recipient_steps
  set native_draft_id = p_draft_id,
      native_version_id = p_version_id,
      last_error = null,
      updated_at = now()
  where id = v_step.id
    and state = 'not_due'
    and due_at is null
    and native_draft_id is null
    and native_version_id is null
    and reserved_native_draft_id = p_draft_id
    and reserved_native_version_id = p_version_id
    and outbound_dispatch_id is null
  returning * into v_step;
  if not found then
    raise exception 'Campaign V2 recipient step draft link was lost' using errcode = '40001';
  end if;

  update public.campaign_v2_draft_reservations
  set linked_at = coalesce(linked_at, now())
  where organization_id = p_organization_id
    and user_id = p_user_id
    and campaign_id = v_campaign.id
    and enrollment_id = v_enrollment.id
    and recipient_step_id = v_step.id
    and draft_id = p_draft_id
    and version_id = p_version_id;
  if not found then
    raise exception 'Campaign V2 durable draft reservation is missing' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'linked', true,
    'stepId', v_step.id,
    'draftId', v_step.native_draft_id,
    'versionId', v_step.native_version_id,
    'state', v_step.state
  );
end;
$$;

create or replace function public.reject_unlinked_campaign_draft_dispatch_v2()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.campaign_v2_draft_reservations%rowtype;
begin
  select reservation.* into v_reservation
  from public.campaign_v2_draft_reservations reservation
  where reservation.organization_id = new.organization_id
    and reservation.user_id = new.user_id
    and reservation.draft_id = new.draft_id;

  if found and not exists (
    select 1
    from public.campaign_recipient_steps crs
    where crs.id = v_reservation.recipient_step_id
      and crs.campaign_id = v_reservation.campaign_id
      and crs.enrollment_id = v_reservation.enrollment_id
      and crs.organization_id = v_reservation.organization_id
      and crs.user_id = v_reservation.user_id
      and crs.native_draft_id = new.draft_id
  ) then
    raise exception 'Reserved Campaign V2 draft must be linked before dispatch' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_v2_reject_unlinked_draft_dispatch on public.outbound_dispatches;
create trigger campaign_v2_reject_unlinked_draft_dispatch
  before insert on public.outbound_dispatches
  for each row execute function public.reject_unlinked_campaign_draft_dispatch_v2();

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
        when crs.state = 'not_due' then 'not_due'
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
      set state = case
            when v_step.native_draft_id is null then 'ready_to_prepare'
            when exists (
              select 1
              from public.messaging_drafts md
              join public.messaging_draft_versions mdv
                on mdv.draft_id = md.id
                and mdv.id = md.current_version_id
                and mdv.organization_id = md.organization_id
                and mdv.user_id = md.user_id
              where md.id = v_step.native_draft_id
                and md.current_version_id = v_step.native_version_id
                and md.organization_id = v_step.organization_id
                and md.user_id = v_step.user_id
                and md.lifecycle = 'ready'
                and mdv.lifecycle = 'ready'
                and mdv.approval ->> 'status' = 'approved'
                and mdv.preflight ->> 'status' = 'passed'
            ) then 'approved'
            else 'review_required'
          end,
          last_error = null,
          updated_at = now()
      where id = v_candidate.id and state = 'not_due';
      if found then v_promoted := v_promoted + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('promoted', v_promoted, 'blocked', v_blocked);
end;
$$;

revoke all on function public.create_first_contact_campaign_plan_v2(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_first_contact_campaign_plan_v2(uuid, uuid, uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_campaign_recipient_step_draft_v2(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.link_campaign_recipient_step_draft_v2(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reject_unlinked_campaign_draft_dispatch_v2()
  from public, anon, authenticated;
revoke all on function public.bind_campaign_recipient_step_dispatch_v2()
  from public, anon, authenticated;
revoke all on function public.guard_campaign_recipient_step_dispatch_link_v2()
  from public, anon, authenticated;
revoke all on function public.sync_campaign_recipient_step_draft_review_v2()
  from public, anon, authenticated;
grant execute on function public.create_first_contact_campaign_plan_v2(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.create_first_contact_campaign_plan_v2(uuid, uuid, uuid, uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.reserve_campaign_recipient_step_draft_v2(uuid, uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.link_campaign_recipient_step_draft_v2(uuid, uuid, uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
