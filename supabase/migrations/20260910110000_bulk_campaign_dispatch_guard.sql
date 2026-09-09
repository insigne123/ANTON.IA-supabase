-- All entry points, including the generic send route, must respect the reviewed batch.
create index bulk_campaign_recipients_gin on public.bulk_campaigns using gin(recipients jsonb_path_ops);

-- Keep provenance after campaign deletion so leftover approved drafts cannot be sent as standalone mail.
alter table public.messaging_drafts add column bulk_campaign_id uuid;
create function public.bind_bulk_campaign_draft_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.bulk_campaign_id is distinct from old.bulk_campaign_id then raise exception 'BULK_CAMPAIGN_PROVENANCE_IMMUTABLE'; end if;
  else
    select id into new.bulk_campaign_id from public.bulk_campaigns where recipients @>
      jsonb_build_array(jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('draftId', new.id::text))));
  end if;
  return new;
end;
$$;
revoke all on function public.bind_bulk_campaign_draft_v1() from public, anon, authenticated;
create trigger bind_bulk_campaign_draft before insert or update on public.messaging_drafts
  for each row execute function public.bind_bulk_campaign_draft_v1();

create function public.guard_bulk_campaign_dispatch_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.bulk_campaigns%rowtype;
  v_person jsonb;
  v_message jsonb;
  v_index bigint;
  v_previous uuid;
  v_sent_at timestamptz;
  v_email text;
begin
  if tg_op = 'UPDATE' and (new.status <> 'sending' or old.status = 'sending') then return new; end if;
  select * into v_campaign from public.bulk_campaigns bc
    where bc.recipients @> jsonb_build_array(jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('draftId', new.draft_id::text))));
  if v_campaign.id is null then
    if new.idempotency_key like 'bulk:%' or exists(select 1 from public.messaging_drafts where id = new.draft_id and bulk_campaign_id is not null)
      then raise exception 'BULK_CAMPAIGN_NOT_FOUND' using errcode = '23514'; end if;
    return new;
  end if;
  -- Use the same campaign lock as review/pause; fail retryably rather than invert row locks.
  if not pg_try_advisory_xact_lock(hashtextextended('bulk-campaign:' || v_campaign.id::text, 0)) then
    raise exception 'BULK_CAMPAIGN_BUSY' using errcode = '40001';
  end if;
  select * into v_campaign from public.bulk_campaigns where id = v_campaign.id;
  if v_campaign.status <> 'approved' or v_campaign.organization_id <> new.organization_id or v_campaign.user_id <> new.user_id
    or not exists(select 1 from public.organization_members where organization_id = new.organization_id and user_id = new.user_id)
    or new.provider <> (case when v_campaign.definition->>'provider' = 'google' then 'gmail' else 'outlook' end)
    or new.idempotency_key <> 'bulk:' || v_campaign.id::text || ':' || new.draft_id::text then
    raise exception 'BULK_CAMPAIGN_NOT_APPROVED' using errcode = '23514';
  end if;
  select r, m.value, m.ordinality into v_person, v_message, v_index
    from jsonb_array_elements(v_campaign.recipients) r,
      jsonb_array_elements(r->'messages') with ordinality m(value, ordinality)
    where m.value->>'draftId' = new.draft_id::text;
  v_email := lower(trim(v_person->>'email'));
  if new.version_id::text <> v_message->>'versionId' or not exists (
    select 1 from public.messaging_draft_versions mv join public.messaging_drafts md on md.id = mv.draft_id
    where mv.id = new.version_id and md.current_version_id = mv.id and mv.content_hash = new.content_hash
      and mv.content->>'subject' = v_message->>'subject' and mv.content->>'text' = v_message->>'body'
      and mv.recipient->>'email' = v_email and mv.approval->>'status' = 'approved' and mv.lifecycle = 'ready'
  ) then raise exception 'BULK_CAMPAIGN_REVIEW_CHANGED' using errcode = '23514'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('privacy-delete:' || v_email, 0)) then
    raise exception 'BULK_CAMPAIGN_CONTACT_BUSY' using errcode = '40001';
  end if;
  if exists(select 1 from public.unsubscribed_emails ue where lower(trim(ue.email)) = v_email
      and (ue.organization_id = new.organization_id or ue.user_id = new.user_id or (ue.organization_id is null and ue.user_id is null)))
    or exists(select 1 from public.excluded_domains where organization_id = new.organization_id and lower(domain) = split_part(v_email, '@', 2))
    or exists(select 1 from public.leads where organization_id = new.organization_id and lower(trim(email)) = v_email and status = 'do_not_contact')
    or exists(select 1 from public.contacted_leads cl where cl.organization_id = new.organization_id and lower(trim(cl.email)) = v_email and (
      cl.campaign_followup_allowed is false or cl.evaluation_status = 'do_not_contact' or cl.status = 'do_not_contact'
      or cl.bounced_at is not null or cl.delivery_status in ('bounced','hard_bounced','soft_bounced')
      or ((v_index > 1 or coalesce((v_campaign.definition#>>'{criteria,excludeReplied}')::boolean, true)) and
        (cl.replied_at is not null or cl.status = 'replied' or nullif(trim(cl.last_reply_text), '') is not null))
    )) then raise exception 'BULK_CAMPAIGN_CONTACT_BLOCKED' using errcode = '23514'; end if;
  if v_index > 1 then
    v_previous := (v_person->'messages'->((v_index - 2)::integer)->>'draftId')::uuid;
    select completed_at into v_sent_at from public.outbound_dispatches
      where draft_id = v_previous and organization_id = new.organization_id and status = 'sent';
    if v_sent_at is null or v_sent_at + make_interval(days => (v_message->>'delayDays')::integer) > now() then
      raise exception 'BULK_CAMPAIGN_NOT_DUE' using errcode = '23514';
    end if;
  elsif v_campaign.definition#>>'{criteria,relationship}' = 'never_contacted' then
    if exists(select 1 from public.contacted_leads where organization_id = new.organization_id and lower(trim(email)) = v_email)
      or exists(select 1 from public.outbound_dispatches where organization_id = new.organization_id and id <> new.id
        and lower(metadata#>>'{recipient,email}') = v_email and status in ('pending','sending','sent','unknown')) then
      raise exception 'BULK_CAMPAIGN_ALREADY_CONTACTED' using errcode = '23514';
    end if;
  else
    select max(at) into v_sent_at from (
      select completed_at at from public.outbound_dispatches where organization_id = new.organization_id and status = 'sent'
        and lower(metadata#>>'{recipient,email}') = v_email
      union all
      select greatest(sent_at, last_follow_up_at) from public.contacted_leads where organization_id = new.organization_id
        and lower(trim(email)) = v_email and status not in ('failed','unknown','pending','scheduled')
    ) history;
    if v_sent_at is null or v_sent_at + make_interval(days => (v_campaign.definition#>>'{criteria,minimumDaysSinceSent}')::integer) > now() then
      raise exception 'BULK_CAMPAIGN_NOT_DUE' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_bulk_campaign_dispatch_v1() from public, anon, authenticated;
create trigger bulk_campaign_dispatch_guard before insert or update on public.outbound_dispatches
  for each row execute function public.guard_bulk_campaign_dispatch_v1();

-- Retention/privacy deletion of a canonical draft also removes its campaign's embedded personal data.
-- Deleting the whole batch preserves the immutable review contract instead of silently changing its audience.
create function public.delete_bulk_campaign_for_draft_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.bulk_campaigns where recipients @> jsonb_build_array(jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('draftId', old.id::text))));
  return old;
end;
$$;
revoke all on function public.delete_bulk_campaign_for_draft_v1() from public, anon, authenticated;
create trigger delete_bulk_campaign_for_draft before delete on public.messaging_drafts
  for each row execute function public.delete_bulk_campaign_for_draft_v1();

-- Unapproved batches have no canonical drafts yet. Source deletion must remove their snapshots too.
create function public.delete_bulk_campaign_for_contact_v1() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if nullif(trim(old.email), '') is not null then
    delete from public.bulk_campaigns where organization_id = old.organization_id
      and recipients @> jsonb_build_array(jsonb_build_object('email', lower(trim(old.email))));
  end if;
  return old;
end;
$$;
revoke all on function public.delete_bulk_campaign_for_contact_v1() from public, anon, authenticated;
create trigger delete_bulk_campaign_for_lead before delete on public.leads
  for each row execute function public.delete_bulk_campaign_for_contact_v1();
create trigger delete_bulk_campaign_for_enriched before delete on public.enriched_leads
  for each row execute function public.delete_bulk_campaign_for_contact_v1();
create trigger delete_bulk_campaign_for_contacted before delete on public.contacted_leads
  for each row execute function public.delete_bulk_campaign_for_contact_v1();
