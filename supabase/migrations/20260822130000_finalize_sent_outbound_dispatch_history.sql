-- Project every confirmed outbound email into contact history, including sends
-- confirmed synchronously by a provider rather than through reconciliation.

-- History repair bookkeeping used to be restricted to reconciled sends. Direct
-- provider confirmations must use the same guarded, append-only bookkeeping.
create or replace function public.enforce_outbound_dispatch_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.privacy_delete', true), '') = 'on'
      or coalesce(auth.role(), '') = 'service_role' then
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

create index if not exists outbound_dispatches_sent_email_history_projection_idx
  on public.outbound_dispatches(last_history_repair_at, completed_at)
  where status = 'sent'
    and channel = 'email'
    and history_repair_status in ('pending', 'failed');

-- The reconciled repair path hashes deterministic IDs with pgcrypto.digest.
-- Its existing security-definer body is retained, but must resolve pgcrypto.
alter function public.repair_reconciled_sent_dispatch_history_v1(uuid)
  set search_path = public, extensions;

create or replace function public.finalize_sent_outbound_dispatch_history_v1(
  p_dispatch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.outbound_dispatches%rowtype;
  v_version public.messaging_draft_versions%rowtype;
  v_existing_contact public.contacted_leads%rowtype;
  v_campaign_contact public.contacted_leads%rowtype;
  v_owned_lead public.leads%rowtype;
  v_email text;
  v_metadata_email text;
  v_version_email text;
  v_subject text;
  v_lead_ref text;
  v_sent_at timestamptz;
  v_message_id text;
  v_thread_id text;
  v_conversation_id text;
  v_internet_message_id text;
  v_thread_key text;
  v_source text := 'outbound_dispatch';
  v_event_source text := 'outbound_dispatch';
  v_contacted_id text;
  v_event_id uuid;
  v_mission_id uuid;
  v_contact_lead_id text;
  v_name text;
  v_company text;
  v_role text;
  v_campaign_contact_id text;
  v_campaign_id text;
  v_campaign_step integer;
  v_contact_data jsonb := '{}'::jsonb;
  v_existing_contact_found boolean := false;
  v_global_suppressed boolean := false;
  v_scoped_suppressed boolean := false;
  v_affected integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_dispatch_id is null then
    raise exception 'dispatch id is required' using errcode = '22023';
  end if;

  -- Read only enough identity to take the same recipient lock as privacy deletion.
  select od.* into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id;
  if not found then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'dispatch_missing');
  end if;
  if v_dispatch.status <> 'sent' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'not_sent');
  end if;
  if v_dispatch.channel <> 'email' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'unsupported_channel');
  end if;

  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.id = v_dispatch.version_id
    and mdv.draft_id = v_dispatch.draft_id
    and mdv.organization_id = v_dispatch.organization_id
    and mdv.user_id = v_dispatch.user_id;

  v_metadata_email := lower(trim(coalesce(v_dispatch.metadata #>> '{recipient,email}', '')));
  v_version_email := lower(trim(coalesce(v_version.recipient ->> 'email', '')));
  v_email := coalesce(nullif(v_version_email, ''), nullif(v_metadata_email, ''));
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'sent email dispatch has no valid recipient email' using errcode = '22023';
  end if;
  if v_metadata_email <> '' and v_version_email <> '' and v_metadata_email <> v_version_email then
    raise exception 'draft recipient does not match sent dispatch metadata' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  select od.* into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
  for update;
  if not found then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'dispatch_missing');
  end if;
  if v_dispatch.status <> 'sent' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'not_sent');
  end if;
  if v_dispatch.channel <> 'email' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'unsupported_channel');
  end if;
  if v_dispatch.history_repair_status = 'complete' then
    return jsonb_build_object('repaired', false, 'finalized', true, 'reason', 'already_complete');
  end if;

  select mdv.* into v_version
  from public.messaging_draft_versions mdv
  where mdv.id = v_dispatch.version_id
    and mdv.draft_id = v_dispatch.draft_id
    and mdv.organization_id = v_dispatch.organization_id
    and mdv.user_id = v_dispatch.user_id;
  if not found then
    raise exception 'sent dispatch draft version is missing' using errcode = '55000';
  end if;

  v_metadata_email := lower(trim(coalesce(v_dispatch.metadata #>> '{recipient,email}', '')));
  v_version_email := lower(trim(coalesce(v_version.recipient ->> 'email', '')));
  if v_email is distinct from coalesce(nullif(v_version_email, ''), nullif(v_metadata_email, ''))
    or (v_metadata_email <> '' and v_version_email <> '' and v_metadata_email <> v_version_email) then
    raise exception 'dispatch recipient changed while acquiring privacy lock' using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  ) into v_global_suppressed;
  select exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and (
        ue.user_id = v_dispatch.user_id
        or ue.organization_id = v_dispatch.organization_id
      )
  ) into v_scoped_suppressed;

  if v_global_suppressed or v_scoped_suppressed then
    update public.outbound_dispatches
    set history_repair_status = 'complete',
        history_repair_attempt_count = history_repair_attempt_count + 1,
        last_history_repair_at = now(),
        history_repair_error = null
    where id = p_dispatch_id
      and status = 'sent'
      and history_repair_status in ('pending', 'failed')
      and history_repair_attempt_count = v_dispatch.history_repair_attempt_count;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'history projection suppression bookkeeping compare-and-set failed' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'repaired', false,
      'finalized', true,
      'reason', case when v_global_suppressed then 'globally_suppressed' else 'scoped_suppressed' end
    );
  end if;

  -- Reconciled sends retain the existing richer campaign and Antonia repair path
  -- after this wrapper has applied the complete suppression policy.
  if v_dispatch.reconciled_at is not null then
    return public.repair_reconciled_sent_dispatch_history_v1(p_dispatch_id);
  end if;

  v_subject := trim(coalesce(v_version.content ->> 'subject', ''));
  if v_subject = '' then
    raise exception 'sent email dispatch draft has no subject' using errcode = '22023';
  end if;
  v_lead_ref := trim(coalesce(
    nullif(v_dispatch.metadata #>> '{recipient,leadRef}', ''),
    nullif(v_version.recipient ->> 'leadRef', ''),
    ''
  ));
  v_sent_at := coalesce(v_dispatch.completed_at, v_dispatch.reconciled_at, v_dispatch.requested_at, now());
  v_message_id := nullif(trim(coalesce(
    v_dispatch.provider_response ->> 'id',
    v_dispatch.provider_response ->> 'messageId',
    v_dispatch.provider_message_id,
    ''
  )), '');
  v_thread_id := nullif(trim(coalesce(v_dispatch.provider_response ->> 'threadId', '')), '');
  v_conversation_id := nullif(trim(coalesce(v_dispatch.provider_response ->> 'conversationId', '')), '');
  v_internet_message_id := nullif(trim(coalesce(v_dispatch.provider_response ->> 'internetMessageId', '')), '');
  v_thread_key := case
    when lower(v_dispatch.provider) = 'gmail' and v_thread_id is not null then concat('gmail:', v_thread_id)
    when lower(v_dispatch.provider) = 'outlook' and v_conversation_id is not null then concat('outlook:', v_conversation_id)
    when v_internet_message_id is not null then concat('msg:', trim(both '<>' from v_internet_message_id))
    when v_message_id is not null then concat(lower(v_dispatch.provider), ':', v_message_id)
    else null
  end;

  if v_dispatch.idempotency_key ~ '^campaign:[^:]+:[^:]+:step:[0-9]+$' then
    v_source := 'campaign';
    v_campaign_id := split_part(v_dispatch.idempotency_key, ':', 2);
    v_campaign_contact_id := split_part(v_dispatch.idempotency_key, ':', 3);
    v_campaign_step := split_part(v_dispatch.idempotency_key, ':', 5)::integer;
  elsif v_dispatch.idempotency_key ~ '^antonia:' then
    v_source := 'antonia';
  elsif v_dispatch.idempotency_key ~ '^suplia:' then
    v_source := 'suplia';
  end if;
  v_event_source := case v_source
    when 'campaign' then 'campaign_cron'
    when 'suplia' then 'suplia'
    else 'outbound_dispatch'
  end;

  if v_lead_ref <> '' then
    select l.* into v_owned_lead
    from public.leads l
    where l.id::text = v_lead_ref
      and l.user_id = v_dispatch.user_id
      and l.organization_id = v_dispatch.organization_id
      and lower(trim(coalesce(l.email, ''))) = v_email
    for update;
  end if;

  select cl.* into v_existing_contact
  from public.contacted_leads cl
  where cl.organization_id = v_dispatch.organization_id
    and cl.user_id = v_dispatch.user_id
    and cl.data @> jsonb_build_object('dispatchId', v_dispatch.id::text)
  order by cl.created_at asc
  limit 1
  for update;
  v_existing_contact_found := found;

  if not v_existing_contact_found and v_campaign_contact_id is not null then
    select cl.* into v_campaign_contact
    from public.contacted_leads cl
    where cl.id = v_campaign_contact_id
      and cl.organization_id = v_dispatch.organization_id
      and cl.user_id = v_dispatch.user_id
      and lower(trim(coalesce(cl.email, ''))) = v_email
    for update;
    if found then
      v_existing_contact := v_campaign_contact;
      v_existing_contact_found := true;
    end if;
  end if;

  v_mission_id := coalesce(v_existing_contact.mission_id, v_owned_lead.mission_id);
  v_contact_lead_id := coalesce(v_owned_lead.id::text, v_existing_contact.lead_id);
  v_name := coalesce(
    nullif(v_existing_contact.name, ''),
    nullif(v_owned_lead.name, ''),
    nullif(v_dispatch.metadata #>> '{recipient,displayName}', ''),
    nullif(v_version.recipient ->> 'displayName', '')
  );
  v_company := coalesce(nullif(v_existing_contact.company, ''), nullif(v_owned_lead.company, ''));
  v_role := coalesce(nullif(v_existing_contact.role, ''), nullif(v_owned_lead.title, ''));
  v_contact_data := coalesce(v_existing_contact.data, '{}'::jsonb) || jsonb_build_object(
    'source', coalesce(nullif(v_existing_contact.data ->> 'source', ''), v_source),
    'dispatchId', coalesce(nullif(v_existing_contact.data ->> 'dispatchId', ''), v_dispatch.id::text),
    'draftId', v_dispatch.draft_id::text,
    'draftVersionId', v_dispatch.version_id::text,
    'contentHash', v_dispatch.content_hash,
    'idempotencyKey', v_dispatch.idempotency_key,
    'leadRef', nullif(v_lead_ref, ''),
    'historyProjectionSource', 'outbound_dispatch'
  ) || case
    when v_campaign_id is not null then jsonb_build_object('campaignId', v_campaign_id, 'stepIndex', v_campaign_step)
    else '{}'::jsonb
  end;

  if v_existing_contact_found then
    update public.contacted_leads as target
    set lead_id = coalesce(v_contact_lead_id, target.lead_id),
        mission_id = coalesce(v_mission_id, target.mission_id),
        name = coalesce(nullif(v_name, ''), target.name),
        email = v_email,
        company = coalesce(nullif(v_company, ''), target.company),
        role = coalesce(nullif(v_role, ''), target.role),
        status = coalesce(nullif(target.status, ''), 'sent'),
        provider = coalesce(nullif(v_dispatch.provider, ''), target.provider),
        subject = coalesce(nullif(target.subject, ''), v_subject),
        message_id = coalesce(v_message_id, target.message_id),
        thread_id = coalesce(v_thread_id, target.thread_id),
        conversation_id = coalesce(v_conversation_id, target.conversation_id),
        internet_message_id = coalesce(v_internet_message_id, target.internet_message_id),
        thread_key = coalesce(v_thread_key, target.thread_key),
        lifecycle_state = coalesce(nullif(target.lifecycle_state, ''), 'sent'),
        last_event_type = case
          when coalesce(target.last_event_at, '-infinity'::timestamptz) >= v_sent_at then target.last_event_type
          else 'sent'
        end,
        last_event_at = greatest(coalesce(target.last_event_at, v_sent_at), v_sent_at),
        sent_at = coalesce(target.sent_at, v_sent_at),
        data = v_contact_data,
        last_follow_up_at = case
          when v_campaign_step is null then target.last_follow_up_at
          else greatest(coalesce(target.last_follow_up_at, v_sent_at), v_sent_at)
        end,
        last_step_idx = case
          when v_campaign_step is null then target.last_step_idx
          else greatest(coalesce(target.last_step_idx, -1), v_campaign_step)
        end,
        follow_up_count = case
          when v_campaign_step is null then coalesce(target.follow_up_count, 0)
          else greatest(coalesce(target.follow_up_count, 0), v_campaign_step + 1)
        end,
        last_update_at = now()
    where target.id = v_existing_contact.id
    returning target.id into v_contacted_id;
  else
    insert into public.contacted_leads (
      user_id, organization_id, lead_id, mission_id, name, email, company, role,
      status, provider, subject, message_id, thread_id, conversation_id, internet_message_id,
      thread_key, lifecycle_state, last_event_type, last_event_at, sent_at, created_at, data,
      last_follow_up_at, last_step_idx, follow_up_count
    ) values (
      v_dispatch.user_id,
      v_dispatch.organization_id,
      v_contact_lead_id,
      v_mission_id,
      v_name,
      v_email,
      v_company,
      v_role,
      'sent',
      v_dispatch.provider,
      v_subject,
      v_message_id,
      v_thread_id,
      v_conversation_id,
      v_internet_message_id,
      v_thread_key,
      'sent',
      'sent',
      v_sent_at,
      v_sent_at,
      v_sent_at,
      v_contact_data,
      case when v_campaign_step is null then null else v_sent_at end,
      coalesce(v_campaign_step, -1),
      case when v_campaign_step is null then 0 else v_campaign_step + 1 end
    )
    returning id into v_contacted_id;
  end if;

  if v_owned_lead.id is not null
    and not (
      lower(coalesce(v_owned_lead.status, '')) in ('contacted', 'replied', 'do_not_contact', 'converted', 'closed_won', 'closed_lost')
      and coalesce(v_owned_lead.last_contacted_at >= v_sent_at, false)
    ) then
    update public.leads
    set last_contacted_at = greatest(coalesce(last_contacted_at, v_sent_at), v_sent_at),
        status = case
          when lower(coalesce(status, '')) in ('contacted', 'replied', 'do_not_contact', 'converted', 'closed_won', 'closed_lost') then status
          else 'contacted'
        end
    where id = v_owned_lead.id
      and user_id = v_dispatch.user_id
      and organization_id = v_dispatch.organization_id;
  end if;

  select ee.id into v_event_id
  from public.email_events ee
  where ee.organization_id = v_dispatch.organization_id
    and ee.event_type = 'sent'
    and ee.meta @> jsonb_build_object('dispatchId', v_dispatch.id::text)
  order by ee.created_at asc
  limit 1
  for update;
  if not found then
    insert into public.email_events (
      organization_id, mission_id, contacted_id, lead_id, provider, event_type,
      event_source, event_at, thread_key, message_id, internet_message_id, meta
    ) values (
      v_dispatch.organization_id,
      v_mission_id,
      v_contacted_id,
      v_contact_lead_id,
      v_dispatch.provider,
      'sent',
      v_event_source,
      v_sent_at,
      v_thread_key,
      v_message_id,
      v_internet_message_id,
      jsonb_build_object(
        'source', v_source,
        'subject', v_subject,
        'dispatchId', v_dispatch.id::text,
        'draftId', v_dispatch.draft_id::text,
        'draftVersionId', v_dispatch.version_id::text,
        'contentHash', v_dispatch.content_hash,
        'idempotencyKey', v_dispatch.idempotency_key,
        'leadRef', nullif(v_lead_ref, '')
      ) || case
        when v_campaign_id is not null then jsonb_build_object('campaignId', v_campaign_id, 'stepIndex', v_campaign_step)
        else '{}'::jsonb
      end
    )
    returning id into v_event_id;
  end if;

  update public.outbound_dispatches
  set history_repair_status = 'complete',
      history_repair_attempt_count = history_repair_attempt_count + 1,
      last_history_repair_at = now(),
      history_repair_error = null
  where id = p_dispatch_id
    and status = 'sent'
    and history_repair_status in ('pending', 'failed')
    and history_repair_attempt_count = v_dispatch.history_repair_attempt_count;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'history projection bookkeeping compare-and-set failed' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'repaired', true,
    'finalized', true,
    'contactedId', v_contacted_id,
    'eventId', v_event_id
  );
end;
$$;

revoke all on function public.finalize_sent_outbound_dispatch_history_v1(uuid) from public;
grant execute on function public.finalize_sent_outbound_dispatch_history_v1(uuid) to service_role;

notify pgrst, 'reload config';
