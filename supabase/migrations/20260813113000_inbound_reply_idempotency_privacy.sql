alter table public.lead_responses
  add column if not exists inbound_event_key text;

alter table public.email_events
  add column if not exists inbound_event_key text;

create table if not exists public.inbound_reply_event_aliases (
  identity_key text primary key,
  event_key text not null,
  contacted_id text not null references public.contacted_leads(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists inbound_reply_event_aliases_event_key_idx
  on public.inbound_reply_event_aliases(event_key);

alter table public.inbound_reply_event_aliases enable row level security;
revoke all on table public.inbound_reply_event_aliases from public, anon, authenticated;
grant all on table public.inbound_reply_event_aliases to service_role;

delete from public.lead_responses lr
where lr.contacted_id is not null
  and not exists (
    select 1
    from public.contacted_leads cl
    where cl.id = lr.contacted_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.lead_responses'::regclass
      and conname = 'lead_responses_contacted_id_fkey'
  ) then
    alter table public.lead_responses
      add constraint lead_responses_contacted_id_fkey
      foreign key (contacted_id)
      references public.contacted_leads(id)
      on delete cascade;
  end if;
end $$;

create unique index if not exists lead_responses_inbound_event_key_uidx
  on public.lead_responses(inbound_event_key)
  where inbound_event_key is not null;

create unique index if not exists email_events_inbound_event_key_uidx
  on public.email_events(inbound_event_key)
  where inbound_event_key is not null;

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
  v_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_provider text := case lower(trim(coalesce(p_provider, '')))
    when 'google' then 'gmail'
    when 'microsoft' then 'outlook'
    else lower(trim(coalesce(p_provider, '')))
  end;
  v_message_id text := nullif(trim(both '<>' from trim(coalesce(p_message_id, ''))), '');
  v_internet_message_id text := nullif(trim(both '<>' from trim(coalesce(p_internet_message_id, ''))), '');
  v_message_identity text;
  v_message_identity_key text;
  v_internet_identity_key text;
  v_identity_keys text[] := '{}'::text[];
  v_event_type text := lower(trim(coalesce(p_event_type, '')));
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_event_key text;
  v_existing_event_key text;
  v_contact public.contacted_leads%rowtype;
  v_response_id uuid;
  v_email_event_id uuid;
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
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid recipient email' using errcode = '22023';
  end if;
  if v_provider = '' then
    raise exception 'provider is required' using errcode = '22023';
  end if;
  if v_event_type not in ('reply', 'bounce') then
    raise exception 'invalid inbound event type' using errcode = '22023';
  end if;

  v_message_identity := coalesce(v_internet_message_id, v_message_id);
  if v_message_identity is null then
    raise exception 'provider message id or internet message id is required' using errcode = '22023';
  end if;

  -- Alias both provider IDs so webhook and mailbox sync overlap even if one has only one ID form.
  if v_internet_message_id is not null then
    v_internet_identity_key := encode(digest(concat_ws(
      chr(31), v_provider, v_internet_message_id, v_email, trim(p_contacted_id)
    ), 'sha256'), 'hex');
    v_identity_keys := array_append(v_identity_keys, v_internet_identity_key);
  end if;
  if v_message_id is not null then
    v_message_identity_key := encode(digest(concat_ws(
      chr(31), v_provider, v_message_id, v_email, trim(p_contacted_id)
    ), 'sha256'), 'hex');
    if not (v_message_identity_key = any(v_identity_keys)) then
      v_identity_keys := array_append(v_identity_keys, v_message_identity_key);
    end if;
  end if;
  v_event_key := v_identity_keys[1];

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  if exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  ) then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'globally_suppressed',
      'eventKey', v_event_key
    );
  end if;

  select cl.*
  into v_contact
  from public.contacted_leads cl
  where cl.id = trim(p_contacted_id)
  for update;

  if not found then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'contact_missing',
      'eventKey', v_event_key
    );
  end if;
  if lower(trim(coalesce(v_contact.email, ''))) <> v_email then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'contact_context_mismatch',
      'eventKey', v_event_key
    );
  end if;
  if nullif(lower(trim(coalesce(v_contact.provider, ''))), '') is not null
    and (case lower(trim(v_contact.provider))
      when 'google' then 'gmail'
      when 'microsoft' then 'outlook'
      else lower(trim(v_contact.provider))
    end) <> v_provider then
    return jsonb_build_object(
      'inserted', false,
      'reason', 'contact_context_mismatch',
      'eventKey', v_event_key
    );
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
  v_delivery_status := case
    when v_is_failure then coalesce(nullif(p_classification ->> 'deliveryStatus', ''), 'soft_bounced')
    else 'replied'
  end;
  v_bounce_category := case when v_is_failure then nullif(p_classification ->> 'bounceCategory', '') end;
  v_bounce_reason := case when v_is_failure then nullif(p_classification ->> 'bounceReason', '') end;

  insert into public.lead_responses (
    lead_id,
    contacted_id,
    organization_id,
    mission_id,
    email_message_id,
    type,
    content,
    created_at,
    inbound_event_key
  ) values (
    v_contact.lead_id,
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
    organization_id,
    mission_id,
    contacted_id,
    lead_id,
    provider,
    event_type,
    event_source,
    event_at,
    thread_key,
    message_id,
    internet_message_id,
    meta,
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

create or replace function public.record_inbound_unsubscribe_v1(
  p_contacted_id text,
  p_recipient_email text,
  p_event_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_recipient_email, '')));
  v_contact public.contacted_leads%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid recipient email' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_contacted_id, '')), '') is null
    or nullif(trim(coalesce(p_event_key, '')), '') is null then
    raise exception 'contacted id and event key are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:', v_email), 0));

  if exists (
    select 1
    from public.unsubscribed_emails ue
    where lower(trim(coalesce(ue.email, ''))) = v_email
      and ue.user_id is null
      and ue.organization_id is null
  ) then
    return jsonb_build_object('recorded', false, 'reason', 'globally_suppressed');
  end if;

  select cl.*
  into v_contact
  from public.contacted_leads cl
  where cl.id = trim(p_contacted_id)
    and lower(trim(coalesce(cl.email, ''))) = v_email
  for update;

  if not found or not exists (
    select 1
    from public.lead_responses lr
    where lr.contacted_id = trim(p_contacted_id)
      and lr.inbound_event_key = trim(p_event_key)
  ) then
    return jsonb_build_object('recorded', false, 'reason', 'inbound_event_missing');
  end if;

  insert into public.unsubscribed_emails (email, user_id, organization_id, reason)
  values (v_email, v_contact.user_id, v_contact.organization_id, 'reply:unsubscribe')
  on conflict (email, user_id, organization_id)
  do update set reason = excluded.reason;

  return jsonb_build_object('recorded', true, 'reason', 'recorded');
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

revoke all on function public.record_inbound_unsubscribe_v1(text, text, text) from public;
grant execute on function public.record_inbound_unsubscribe_v1(text, text, text) to service_role;

notify pgrst, 'reload config';
