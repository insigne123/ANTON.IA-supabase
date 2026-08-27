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

  -- Serialize every email claim with feature activation for its organization.
  -- A dispatch cannot commit between the rollout report and the flag update.
  if v_dispatch.channel = 'email' then
    perform pg_advisory_xact_lock(hashtextextended(concat(
      'organization-collaboration-rollout:', v_dispatch.organization_id::text
    ), 0));
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

revoke all on function public.claim_outbound_dispatch_sending_v2(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_outbound_dispatch_sending_v2(uuid, timestamptz, integer) to service_role;

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

notify pgrst, 'reload schema';
