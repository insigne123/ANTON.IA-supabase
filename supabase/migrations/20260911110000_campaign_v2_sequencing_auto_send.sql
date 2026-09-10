-- Campaign V2 sequencing: enable for all organizations, allow editing the
-- follow-up plan before the initial send, and expose due approved steps for
-- the automatic sender. Auto-send only fires for campaigns whose settings
-- carry auto_send = true and for versions the user already approved.

-- 1. Enable Campaign V2 everywhere (it was a single-org canary).
update public.organizations
set feature_campaigns_v2_enabled = true
where coalesce(feature_campaigns_v2_enabled, false) = false;

alter table public.organizations
  alter column feature_campaigns_v2_enabled set default true;

-- 2. Replace the follow-up steps of a plan that is still waiting for its
-- initial send. Auto-generated drafts of removed steps are archived, never
-- deleted; user content is preserved.
create or replace function public.update_first_contact_plan_steps_v2(
  p_campaign_id uuid,
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
  v_campaign public.campaigns%rowtype;
  v_enrollment public.campaign_enrollments%rowtype;
  v_draft public.messaging_drafts%rowtype;
  v_item jsonb;
  v_ordinality bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 4 then
    raise exception 'Campaign V2 requires between 1 and 4 follow-up steps' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'campaign-v2-draft:', p_organization_id, ':', p_draft_id
  ), 0));

  select c.* into v_campaign
  from public.campaigns c
  where c.id = p_campaign_id
    and c.organization_id = p_organization_id
    and c.user_id = p_user_id
    and c.outreach_version = 2
    and c.initial_native_draft_id = p_draft_id
  for update;
  if not found then
    raise exception 'Campaign V2 plan not found' using errcode = 'P0002';
  end if;
  if v_campaign.v2_status <> 'draft' then
    raise exception 'Campaign V2 plan can only change before the initial send' using errcode = '55000';
  end if;

  select ce.* into v_enrollment
  from public.campaign_enrollments ce
  where ce.campaign_id = v_campaign.id
    and ce.organization_id = p_organization_id
    and ce.user_id = p_user_id
  for update;
  if not found or v_enrollment.status <> 'pending_initial_send' then
    raise exception 'Campaign V2 plan can only change before the initial send' using errcode = '55000';
  end if;

  select md.* into v_draft
  from public.messaging_drafts md
  where md.id = p_draft_id
    and md.organization_id = p_organization_id
    and md.user_id = p_user_id
  for update;
  if not found or v_draft.current_version_id <> p_version_id then
    raise exception 'Initial native draft version is no longer current' using errcode = 'P0002';
  end if;

  for v_item, v_ordinality in
    select item, ordinality from jsonb_array_elements(p_steps) with ordinality as rows(item, ordinality)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or length(trim(coalesce(v_item ->> 'name', ''))) not between 1 and 120
      or coalesce(v_item ->> 'offsetDays', '') !~ '^[0-9]+$'
      or (v_item ->> 'offsetDays')::integer not between 1 and 30
      or length(trim(coalesce(v_item ->> 'instruction', ''))) not between 1 and 1000 then
      raise exception 'Invalid Campaign V2 follow-up step at position %', v_ordinality using errcode = '22023';
    end if;
  end loop;

  -- Archive auto-generated drafts of the steps being replaced.
  update public.messaging_drafts md
  set lifecycle = 'archived', updated_at = now()
  from public.campaign_recipient_steps crs
  where crs.enrollment_id = v_enrollment.id
    and crs.step_index > 0
    and md.id = crs.native_draft_id
    and md.organization_id = p_organization_id
    and md.user_id = p_user_id
    and md.lifecycle = 'ready';

  delete from public.campaign_recipient_steps
  where enrollment_id = v_enrollment.id
    and step_index > 0;

  delete from public.campaign_sequence_steps_v2
  where sequence_version_id = v_enrollment.sequence_version_id
    and step_index > 0;

  insert into public.campaign_sequence_steps_v2 (
    sequence_version_id, organization_id, user_id, step_index, name, offset_days, instruction
  )
  select
    v_enrollment.sequence_version_id, p_organization_id, p_user_id, rows.ordinality::integer,
    trim(rows.item ->> 'name'), (rows.item ->> 'offsetDays')::integer,
    trim(rows.item ->> 'instruction')
  from jsonb_array_elements(p_steps) with ordinality as rows(item, ordinality);

  insert into public.campaign_recipient_steps (
    enrollment_id, campaign_id, sequence_step_id, organization_id, user_id,
    step_index, state, native_draft_id, native_version_id
  )
  select
    v_enrollment.id, v_campaign.id, css.id, p_organization_id, p_user_id,
    css.step_index, 'not_due', null, null
  from public.campaign_sequence_steps_v2 css
  where css.sequence_version_id = v_enrollment.sequence_version_id
    and css.step_index > 0
  order by css.step_index;

  update public.campaigns
  set settings = coalesce(settings, '{}'::jsonb)
      || jsonb_build_object('followUpDrafting', jsonb_build_object(
           'updatedAt', now(),
           'stepCount', jsonb_array_length(p_steps))),
      updated_at = now()
  where id = v_campaign.id;

  return jsonb_build_object(
    'updated', true,
    'campaignId', v_campaign.id,
    'enrollmentId', v_enrollment.id,
    'stepCount', jsonb_array_length(p_steps)
  );
end;
$$;

-- 3. Claim due approved follow-up steps for the automatic sender. The claim
-- only locks the row for this transaction; the dispatch insert moves the
-- step forward through the existing triggers, so concurrent workers stay
-- safe through the deterministic idempotency key.
create or replace function public.claim_due_campaign_v2_auto_steps_v2(
  p_limit integer default 25
)
returns table (
  step_id uuid,
  organization_id uuid,
  user_id uuid,
  campaign_id uuid,
  enrollment_id uuid,
  step_index integer,
  recipient_email text,
  native_draft_id uuid,
  native_version_id uuid,
  due_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid Campaign V2 auto-send limit' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select crs.id
    from public.campaign_recipient_steps crs
    join public.campaign_enrollments ce on ce.id = crs.enrollment_id and ce.status = 'active'
    join public.campaigns c on c.id = crs.campaign_id
      and c.outreach_version = 2 and c.v2_status = 'active'
      and coalesce(c.settings ->> 'auto_send', 'false') = 'true'
    join public.organizations o on o.id = crs.organization_id and o.feature_campaigns_v2_enabled
    join public.messaging_drafts md on md.id = crs.native_draft_id
      and md.organization_id = crs.organization_id
      and md.user_id = crs.user_id
      and md.current_version_id = crs.native_version_id
      and md.lifecycle = 'ready'
    join public.messaging_draft_versions mdv on mdv.id = crs.native_version_id
      and mdv.draft_id = crs.native_draft_id
      and mdv.organization_id = crs.organization_id
      and mdv.user_id = crs.user_id
      and mdv.lifecycle = 'ready'
      and mdv.approval ->> 'status' = 'approved'
      and mdv.preflight ->> 'status' = 'passed'
    where crs.state = 'approved'
      and crs.step_index > 0
      and crs.due_at is not null
      and crs.due_at <= now()
      and crs.outbound_dispatch_id is null
    order by crs.due_at, crs.id
    limit p_limit
    for update of crs skip locked
  )
  select crs.id, crs.organization_id, crs.user_id, crs.campaign_id,
    crs.enrollment_id, crs.step_index, ce.recipient_email,
    crs.native_draft_id, crs.native_version_id, crs.due_at
  from public.campaign_recipient_steps crs
  join public.campaign_enrollments ce on ce.id = crs.enrollment_id
  join candidates on candidates.id = crs.id;
end;
$$;

revoke all on function public.update_first_contact_plan_steps_v2(uuid, uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_due_campaign_v2_auto_steps_v2(integer)
  from public, anon, authenticated;
grant execute on function public.update_first_contact_plan_steps_v2(uuid, uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.claim_due_campaign_v2_auto_steps_v2(integer)
  to service_role;

notify pgrst, 'reload schema';
