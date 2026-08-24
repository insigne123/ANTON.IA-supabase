-- Campaign delivery is the durable projection of a campaign dispatch. It is
-- deliberately keyed by both the campaign recipient/step and the dispatch.
alter table public.contacted_leads
  add column if not exists linkedin_message_status text default 'sent';

create table if not exists public.campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contacted_id text not null references public.contacted_leads(id) on delete cascade,
  recipient_key text not null,
  recipient_email text not null,
  step_index integer not null,
  dispatch_id uuid not null unique references public.outbound_dispatches(id) on delete cascade,
  draft_id uuid not null,
  draft_version_id uuid not null,
  delivery_state text not null,
  provider text not null,
  provider_message_id text,
  provider_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  requested_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  sent_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_deliveries_recipient_key_check check (length(trim(recipient_key)) between 1 and 500),
  constraint campaign_deliveries_recipient_email_check check (
    recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint campaign_deliveries_step_index_check check (step_index >= 0),
  constraint campaign_deliveries_state_check check (
    delivery_state in ('pending', 'sending', 'sent', 'failed', 'deferred', 'unknown')
  ),
  constraint campaign_deliveries_provider_check check (length(trim(provider)) between 1 and 100),
  constraint campaign_deliveries_metadata_check check (jsonb_typeof(provider_metadata) = 'object'),
  unique (organization_id, campaign_id, recipient_key, step_index)
);

create index if not exists campaign_deliveries_campaign_state_idx
  on public.campaign_deliveries(organization_id, campaign_id, delivery_state, step_index desc, sent_at desc);

create index if not exists campaign_deliveries_contacted_idx
  on public.campaign_deliveries(contacted_id, sent_at desc);

-- Dispatches already carry immutable campaign identity and recipient metadata.
-- Backfill only rows with a complete current campaign/contact relationship; old
-- sent_records without a dispatch remain a legacy fallback rather than guessed data.
insert into public.campaign_deliveries (
  organization_id,
  user_id,
  campaign_id,
  contacted_id,
  recipient_key,
  recipient_email,
  step_index,
  dispatch_id,
  draft_id,
  draft_version_id,
  delivery_state,
  provider,
  provider_message_id,
  provider_metadata,
  error_code,
  error_message,
  requested_at,
  started_at,
  completed_at,
  sent_at,
  reconciled_at
)
select
  od.organization_id,
  od.user_id,
  c.id,
  cl.id,
  coalesce(nullif(trim(cl.lead_id), ''), cl.id),
  lower(trim(od.metadata #>> '{recipient,email}')),
  od.campaign_step_index,
  od.id,
  od.draft_id,
  od.version_id,
  od.status,
  od.provider,
  nullif(trim(od.provider_message_id), ''),
  jsonb_build_object(
    'dispatchId', od.id::text,
    'idempotencyKey', od.idempotency_key,
    'draftId', od.draft_id::text,
    'draftVersionId', od.version_id::text,
    'contentHash', od.content_hash,
    'providerResponse', coalesce(od.provider_response, 'null'::jsonb)
  ),
  od.error_code,
  od.error_message,
  od.requested_at,
  od.started_at,
  od.completed_at,
  case
    when od.status = 'sent' then coalesce(od.completed_at, od.reconciled_at, od.requested_at)
    else null
  end,
  od.reconciled_at
from (
  select
    od.*,
    case
      when od.idempotency_key ~* '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
        then split_part(od.idempotency_key, ':', 2)::uuid
      else null
    end as campaign_dispatch_id,
    case
      when split_part(od.idempotency_key, ':', 5) ~ '^[0-9]{1,9}$'
        then split_part(od.idempotency_key, ':', 5)::integer
      else null
    end as campaign_step_index
  from public.outbound_dispatches od
) od
join public.campaigns c
  on c.id = od.campaign_dispatch_id
  and c.organization_id = od.organization_id
  and c.user_id = od.user_id
join public.contacted_leads cl
  on cl.id = split_part(od.idempotency_key, ':', 3)
  and cl.organization_id = od.organization_id
  and cl.user_id = od.user_id
where od.campaign_dispatch_id is not null
  and od.campaign_step_index is not null
  and od.idempotency_key ~* '^campaign:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[^:]+:step:[0-9]{1,9}$'
  and lower(trim(od.metadata #>> '{recipient,email}')) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
on conflict do nothing;

alter table public.campaign_deliveries enable row level security;
revoke all on table public.campaign_deliveries from public, anon, authenticated;
grant select on table public.campaign_deliveries to authenticated;
grant all on table public.campaign_deliveries to service_role;

drop policy if exists "Organization members can read campaign deliveries" on public.campaign_deliveries;
create policy "Organization members can read campaign deliveries"
  on public.campaign_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = campaign_deliveries.organization_id
        and om.user_id = auth.uid()
    )
  );

create or replace function public.finalize_campaign_delivery_outcome_v1(
  p_dispatch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_dispatch public.outbound_dispatches%rowtype;
  v_campaign public.campaigns%rowtype;
  v_contact public.contacted_leads%rowtype;
  v_delivery public.campaign_deliveries%rowtype;
  v_campaign_id uuid;
  v_contacted_id text;
  v_recipient_key text;
  v_recipient_email text;
  v_step_index integer;
  v_sent_at timestamptz;
  v_current_campaign_record jsonb := '{}'::jsonb;
  v_current_campaign_step integer;
  v_provider_metadata jsonb;
  v_delivery_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_dispatch_id is null then
    raise exception 'dispatch id is required' using errcode = '22023';
  end if;

  select od.*
  into v_dispatch
  from public.outbound_dispatches od
  where od.id = p_dispatch_id
  for update;
  if not found then
    return jsonb_build_object('isCampaign', false, 'finalized', true, 'reason', 'dispatch_missing');
  end if;

  if v_dispatch.idempotency_key !~ '^campaign:[^:]+:[^:]+:step:[0-9]+$' then
    return jsonb_build_object('isCampaign', false, 'finalized', true, 'reason', 'not_campaign_dispatch');
  end if;

  begin
    v_campaign_id := split_part(v_dispatch.idempotency_key, ':', 2)::uuid;
    v_contacted_id := split_part(v_dispatch.idempotency_key, ':', 3);
    v_step_index := split_part(v_dispatch.idempotency_key, ':', 5)::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('isCampaign', true, 'finalized', false, 'reason', 'invalid_campaign_dispatch_key');
  end;

  select cl.*
  into v_contact
  from public.contacted_leads cl
  where cl.id = v_contacted_id
    and cl.organization_id = v_dispatch.organization_id
    and cl.user_id = v_dispatch.user_id
  for update;
  if not found then
    return jsonb_build_object('isCampaign', true, 'finalized', false, 'reason', 'campaign_contact_missing');
  end if;

  v_recipient_email := lower(trim(coalesce(v_dispatch.metadata #>> '{recipient,email}', '')));
  if v_recipient_email = ''
    or v_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('isCampaign', true, 'finalized', false, 'reason', 'campaign_dispatch_recipient_missing');
  end if;
  v_recipient_key := coalesce(nullif(trim(v_contact.lead_id), ''), v_contact.id);

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'campaign-delivery:',
    v_dispatch.organization_id::text,
    ':',
    v_campaign_id::text,
    ':',
    v_recipient_key,
    ':',
    v_step_index::text
  ), 0));

  select c.*
  into v_campaign
  from public.campaigns c
  where c.id = v_campaign_id
    and c.organization_id = v_dispatch.organization_id
    and c.user_id = v_dispatch.user_id
  for update;
  if not found then
    return jsonb_build_object('isCampaign', true, 'finalized', false, 'reason', 'campaign_missing');
  end if;

  select cd.*
  into v_delivery
  from public.campaign_deliveries cd
  where cd.organization_id = v_dispatch.organization_id
    and cd.campaign_id = v_campaign_id
    and cd.recipient_key = v_recipient_key
    and cd.step_index = v_step_index
  for update;

  if found and v_delivery.dispatch_id <> v_dispatch.id then
    return jsonb_build_object(
      'isCampaign', true,
      'finalized', false,
      'reason', 'recipient_step_already_claimed',
      'deliveryId', v_delivery.id,
      'deliveryState', v_delivery.delivery_state
    );
  end if;

  v_sent_at := case
    when v_dispatch.status = 'sent' then coalesce(
      v_dispatch.completed_at,
      v_dispatch.reconciled_at,
      v_dispatch.requested_at,
      now()
    )
    else null
  end;
  v_provider_metadata := jsonb_build_object(
    'dispatchId', v_dispatch.id::text,
    'idempotencyKey', v_dispatch.idempotency_key,
    'draftId', v_dispatch.draft_id::text,
    'draftVersionId', v_dispatch.version_id::text,
    'contentHash', v_dispatch.content_hash,
    'providerResponse', coalesce(v_dispatch.provider_response, 'null'::jsonb)
  );

  if found then
    update public.campaign_deliveries
    set delivery_state = case
          when v_delivery.delivery_state = 'sent' then 'sent'
          else v_dispatch.status
        end,
        provider = v_dispatch.provider,
        provider_message_id = coalesce(nullif(trim(v_dispatch.provider_message_id), ''), provider_message_id),
        provider_metadata = provider_metadata || v_provider_metadata,
        error_code = case
          when v_dispatch.status in ('failed', 'deferred', 'unknown') then v_dispatch.error_code
          else null
        end,
        error_message = case
          when v_dispatch.status in ('failed', 'deferred', 'unknown') then v_dispatch.error_message
          else null
        end,
        started_at = coalesce(v_dispatch.started_at, started_at),
        completed_at = coalesce(v_dispatch.completed_at, completed_at),
        sent_at = coalesce(sent_at, v_sent_at),
        reconciled_at = coalesce(v_dispatch.reconciled_at, reconciled_at),
        updated_at = now()
    where id = v_delivery.id
    returning id into v_delivery_id;
  else
    insert into public.campaign_deliveries (
      organization_id,
      user_id,
      campaign_id,
      contacted_id,
      recipient_key,
      recipient_email,
      step_index,
      dispatch_id,
      draft_id,
      draft_version_id,
      delivery_state,
      provider,
      provider_message_id,
      provider_metadata,
      error_code,
      error_message,
      requested_at,
      started_at,
      completed_at,
      sent_at,
      reconciled_at
    ) values (
      v_dispatch.organization_id,
      v_dispatch.user_id,
      v_campaign_id,
      v_contact.id,
      v_recipient_key,
      v_recipient_email,
      v_step_index,
      v_dispatch.id,
      v_dispatch.draft_id,
      v_dispatch.version_id,
      v_dispatch.status,
      v_dispatch.provider,
      nullif(trim(v_dispatch.provider_message_id), ''),
      v_provider_metadata,
      v_dispatch.error_code,
      v_dispatch.error_message,
      v_dispatch.requested_at,
      v_dispatch.started_at,
      v_dispatch.completed_at,
      v_sent_at,
      v_dispatch.reconciled_at
    )
    returning id into v_delivery_id;
  end if;

  if v_dispatch.status = 'sent' then
    v_current_campaign_record := coalesce(v_campaign.sent_records -> v_recipient_key, '{}'::jsonb);
    v_current_campaign_step := case
      when coalesce(v_current_campaign_record ->> 'lastStepIdx', '') ~ '^-?[0-9]+$'
        then (v_current_campaign_record ->> 'lastStepIdx')::integer
      else null
    end;

    if coalesce(v_current_campaign_step, -1) <= v_step_index then
      update public.campaigns
      set sent_records = jsonb_set(
            coalesce(sent_records, '{}'::jsonb),
            array[v_recipient_key],
            v_current_campaign_record || jsonb_build_object(
              'lastStepIdx', v_step_index,
              'lastSentAt', case
                when v_current_campaign_step = v_step_index
                  and nullif(v_current_campaign_record ->> 'lastSentAt', '') is not null
                  then v_current_campaign_record ->> 'lastSentAt'
                else to_char(v_sent_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              end
            ),
            true
          ),
          updated_at = now()
      where id = v_campaign.id
        and organization_id = v_dispatch.organization_id
        and user_id = v_dispatch.user_id;
    end if;
  end if;

  return jsonb_build_object(
    'isCampaign', true,
    'finalized', true,
    'deliveryId', v_delivery_id,
    'deliveryState', v_dispatch.status
  );
end;
$$;

revoke all on function public.finalize_campaign_delivery_outcome_v1(uuid) from public;
grant execute on function public.finalize_campaign_delivery_outcome_v1(uuid) to service_role;

-- Version one accepted only email-backed contacts. The same RPC now admits
-- provider adapters without an email identity (for example, LinkedIn), while
-- retaining the old email-qualified aliases for Gmail/Outlook/webhook overlap.
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
set search_path = public, extensions
as $$
declare
  v_supplied_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_email text;
  v_contact_email text;
  v_provider text := case lower(trim(coalesce(p_provider, '')))
    when 'google' then 'gmail'
    when 'microsoft' then 'outlook'
    else lower(trim(coalesce(p_provider, '')))
  end;
  v_message_id text := nullif(trim(both '<>' from trim(coalesce(p_message_id, ''))), '');
  v_internet_message_id text := nullif(trim(both '<>' from trim(coalesce(p_internet_message_id, ''))), '');
  v_identity_value text;
  v_identity_key text;
  v_identity_keys text[] := '{}'::text[];
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_event_key text;
  v_existing_event_key text;
  v_contact public.contacted_leads%rowtype;
  v_response_id uuid;
  v_email_event_id uuid;
  v_lead_response_lead_id uuid;
  v_intent text;
  v_sentiment text;
  v_summary text;
  v_reason text;
  v_evaluation_status text;
  v_confidence numeric;
  v_should_continue boolean;
  v_is_failure boolean;
  v_delivery_status text;
  v_bounce_category text;
  v_bounce_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_contacted_id, '')), '') is null then
    raise exception 'contacted id is required' using errcode = '22023';
  end if;
  if v_provider = '' then
    raise exception 'provider is required' using errcode = '22023';
  end if;
  if v_event_type not in ('reply', 'bounce') then
    raise exception 'invalid inbound event type' using errcode = '22023';
  end if;
  if v_message_id is null and v_internet_message_id is null then
    raise exception 'provider message id or internet message id is required' using errcode = '22023';
  end if;
  if v_supplied_email <> '' and v_supplied_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid recipient email' using errcode = '22023';
  end if;

  -- This read derives a privacy lock only. Context is locked and rechecked below.
  select cl.*
  into v_contact
  from public.contacted_leads cl
  where cl.id = trim(p_contacted_id);
  if not found then
    return jsonb_build_object('inserted', false, 'reason', 'contact_missing', 'eventKey', '');
  end if;

  v_contact_email := nullif(lower(trim(coalesce(v_contact.email, ''))), '');
  v_email := case
    when v_supplied_email <> '' then v_supplied_email
    when v_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then v_contact_email
    else null
  end;

  foreach v_identity_value in array array[v_internet_message_id, v_message_id] loop
    if v_identity_value is null then
      continue;
    end if;
    if v_email is not null then
      v_identity_key := encode(digest(concat_ws(
        chr(31), v_provider, v_identity_value, v_email, trim(p_contacted_id)
      ), 'sha256'), 'hex');
      if not (v_identity_key = any(v_identity_keys)) then
        v_identity_keys := array_append(v_identity_keys, v_identity_key);
      end if;
    end if;
    v_identity_key := encode(digest(concat_ws(
      chr(31), v_provider, v_identity_value, trim(p_contacted_id)
    ), 'sha256'), 'hex');
    if not (v_identity_key = any(v_identity_keys)) then
      v_identity_keys := array_append(v_identity_keys, v_identity_key);
    end if;
  end loop;
  v_event_key := v_identity_keys[1];

  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));
  end if;

  select cl.*
  into v_contact
  from public.contacted_leads cl
  where cl.id = trim(p_contacted_id)
  for update;
  if not found then
    return jsonb_build_object('inserted', false, 'reason', 'contact_missing', 'eventKey', v_event_key);
  end if;
  v_contact_email := nullif(lower(trim(coalesce(v_contact.email, ''))), '');
  if v_supplied_email <> ''
    and v_contact_email <> v_supplied_email then
    return jsonb_build_object('inserted', false, 'reason', 'contact_context_mismatch', 'eventKey', v_event_key);
  end if;
  if v_supplied_email = ''
    and v_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and v_email is distinct from v_contact_email then
    return jsonb_build_object('inserted', false, 'reason', 'contact_context_mismatch', 'eventKey', v_event_key);
  end if;
  if nullif(lower(trim(coalesce(v_contact.provider, ''))), '') is not null
    and (case lower(trim(v_contact.provider))
      when 'google' then 'gmail'
      when 'microsoft' then 'outlook'
      else lower(trim(v_contact.provider))
    end) <> v_provider then
    return jsonb_build_object('inserted', false, 'reason', 'contact_context_mismatch', 'eventKey', v_event_key);
  end if;

  if v_email is not null and exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  ) then
    return jsonb_build_object('inserted', false, 'reason', 'globally_suppressed', 'eventKey', v_event_key);
  end if;

  select alias.event_key
  into v_existing_event_key
  from public.inbound_reply_event_aliases alias
  where alias.identity_key = any(v_identity_keys)
  limit 1;
  if found then
    v_event_key := v_existing_event_key;
    insert into public.inbound_reply_event_aliases (identity_key, event_key, contacted_id)
    select identity_key, v_event_key, v_contact.id
    from unnest(v_identity_keys) as identity_key
    on conflict (identity_key) do nothing;

    select lr.id
    into v_response_id
    from public.lead_responses lr
    where lr.inbound_event_key = v_event_key;
    select ee.id
    into v_email_event_id
    from public.email_events ee
    where ee.inbound_event_key = v_event_key;

    return jsonb_build_object(
      'inserted', false,
      'reason', 'duplicate',
      'eventKey', v_event_key,
      'leadResponseId', v_response_id,
      'emailEventId', v_email_event_id
    );
  end if;

  if p_classification is null or jsonb_typeof(p_classification) <> 'object' then
    raise exception 'classification is required' using errcode = '22023';
  end if;

  v_intent := lower(trim(coalesce(p_classification ->> 'intent', 'unknown')));
  v_sentiment := lower(trim(coalesce(p_classification ->> 'sentiment', 'neutral')));
  v_summary := nullif(trim(coalesce(p_classification ->> 'summary', '')), '');
  v_reason := nullif(trim(coalesce(p_classification ->> 'reason', '')), '');
  v_evaluation_status := lower(trim(coalesce(p_classification ->> 'evaluationStatus', 'pending')));
  v_confidence := case
    when jsonb_typeof(p_classification -> 'confidence') = 'number'
      then (p_classification ->> 'confidence')::numeric
    else 0.2
  end;
  v_should_continue := case
    when jsonb_typeof(p_classification -> 'shouldContinue') = 'boolean'
      then (p_classification ->> 'shouldContinue')::boolean
    else false
  end;
  v_is_failure := v_event_type = 'bounce' or v_intent = 'delivery_failure';
  v_delivery_status := case when v_is_failure
    then coalesce(nullif(p_classification ->> 'deliveryStatus', ''), 'soft_bounced')
    else 'replied'
  end;
  v_bounce_category := case when v_is_failure then nullif(p_classification ->> 'bounceCategory', '') end;
  v_bounce_reason := case when v_is_failure then nullif(p_classification ->> 'bounceReason', '') end;
  v_lead_response_lead_id := case
    when coalesce(v_contact.lead_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then v_contact.lead_id::uuid
    else null
  end;

  insert into public.lead_responses (
    lead_id, contacted_id, organization_id, mission_id, email_message_id,
    type, content, created_at, inbound_event_key
  ) values (
    v_lead_response_lead_id,
    v_contact.id,
    v_contact.organization_id,
    v_contact.mission_id,
    coalesce(v_message_id, v_internet_message_id),
    v_event_type,
    nullif(p_content, ''),
    v_event_at,
    v_event_key
  )
  returning id into v_response_id;

  insert into public.email_events (
    organization_id, mission_id, contacted_id, lead_id, provider, event_type,
    event_source, event_at, thread_key, message_id, internet_message_id, meta,
    inbound_event_key
  ) values (
    v_contact.organization_id,
    v_contact.mission_id,
    v_contact.id,
    v_contact.lead_id,
    v_provider,
    v_event_type,
    nullif(trim(coalesce(p_event_source, '')), ''),
    v_event_at,
    nullif(trim(coalesce(p_thread_key, '')), ''),
    v_message_id,
    v_internet_message_id,
    jsonb_build_object(
      'subject', nullif(p_subject, ''),
      'preview', nullif(p_preview, '')
    ),
    v_event_key
  )
  returning id into v_email_event_id;

  insert into public.inbound_reply_event_aliases (identity_key, event_key, contacted_id)
  select identity_key, v_event_key, v_contact.id
  from unnest(v_identity_keys) as identity_key;

  update public.contacted_leads
  set status = case when v_is_failure then 'failed' else 'replied' end,
      replied_at = case when v_is_failure then null else v_event_at end,
      delivery_status = v_delivery_status,
      bounced_at = case when v_is_failure then v_event_at else null end,
      bounce_category = v_bounce_category,
      bounce_reason = v_bounce_reason,
      reply_message_id = coalesce(v_message_id, v_internet_message_id),
      reply_subject = nullif(p_subject, ''),
      reply_preview = nullif(p_preview, ''),
      reply_snippet = nullif(p_preview, ''),
      last_reply_text = nullif(left(coalesce(p_content, ''), 4000), ''),
      reply_intent = v_intent,
      reply_sentiment = v_sentiment,
      reply_confidence = v_confidence,
      reply_summary = v_summary,
      campaign_followup_allowed = v_should_continue,
      campaign_followup_reason = v_reason,
      evaluation_status = v_evaluation_status,
      engagement_score = coalesce(engagement_score, 0) + case when v_is_failure then 0 else 10 end,
      last_interaction_at = v_event_at,
      last_update_at = now(),
      last_follow_up_at = case when v_is_failure then last_follow_up_at else v_event_at end,
      thread_key = coalesce(nullif(trim(coalesce(p_thread_key, '')), ''), thread_key),
      thread_id = coalesce(nullif(trim(coalesce(p_thread_id, '')), ''), thread_id),
      conversation_id = coalesce(nullif(trim(coalesce(p_conversation_id, '')), ''), conversation_id),
      linkedin_message_status = case
        when v_provider = 'linkedin' and not v_is_failure then 'replied'
        else linkedin_message_status
      end,
      last_event_type = v_event_type,
      last_event_at = v_event_at,
      lifecycle_state = case when v_is_failure then 'bounced' else 'replied' end
  where id = v_contact.id;
  if not found then
    raise exception 'contacted row disappeared during inbound ingestion' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'inserted', true,
    'reason', 'inserted',
    'eventKey', v_event_key,
    'leadResponseId', v_response_id,
    'emailEventId', v_email_event_id
  );
end;
$$;

revoke all on function public.ingest_inbound_reply_v1(
  text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) from public;
grant execute on function public.ingest_inbound_reply_v1(
  text, text, text, text, text, text, text, timestamptz,
  text, text, text, text, text, text, jsonb
) to service_role;

notify pgrst, 'reload config';
