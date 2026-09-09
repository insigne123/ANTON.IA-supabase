-- Forward-only. Versioned edit of approved/paused pending messages; sent and in-flight content stays frozen.
create function public.revise_bulk_campaign_pending_v1(
  p_id uuid, p_organization_id uuid, p_user_id uuid, p_expected_revision integer,
  p_review_hash text, p_new_review_hash text, p_definition jsonb, p_recipients jsonb, p_drafts jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.bulk_campaigns%rowtype;
  v_old jsonb; v_new jsonb; v_msg jsonb; v_existing jsonb;
  v_item jsonb; v_payload jsonb;
  v_old_emails text[]; v_new_emails text[];
  v_editable integer := 0;
  v_index integer;
  v_locked boolean;
  v_old_draft uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists (
    select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_user_id
  ) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_new_review_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_REVISE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bulk-campaign:' || p_id::text, 0));
  select * into v_campaign from public.bulk_campaigns where id = p_id for update;
  if v_campaign.id is null or v_campaign.organization_id <> p_organization_id or v_campaign.user_id <> p_user_id then
    raise exception 'CAMPAIGN_NOT_FOUND' using errcode = '42501';
  end if;
  if v_campaign.revision <> p_expected_revision or v_campaign.review_hash is distinct from p_review_hash then
    raise exception 'CAMPAIGN_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_campaign.status not in ('approved', 'paused') then raise exception 'CAMPAIGN_FROZEN'; end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) < 1 then raise exception 'INVALID_REVISE'; end if;

  select array_agg(x order by x) into v_old_emails
    from (select distinct r->>'email' as x from jsonb_array_elements(v_campaign.recipients) r) s;
  select array_agg(x order by x) into v_new_emails
    from (select distinct r->>'email' as x from jsonb_array_elements(p_recipients) r) s;
  if v_old_emails is distinct from v_new_emails then raise exception 'INVALID_REVISE_AUDIENCE'; end if;

  for v_new in select value from jsonb_array_elements(p_recipients) loop
    select r into v_old from jsonb_array_elements(v_campaign.recipients) r where r->>'email' = v_new->>'email';
    if v_old is null then raise exception 'INVALID_REVISE_AUDIENCE'; end if;
    if jsonb_array_length(v_old->'messages') <> jsonb_array_length(v_new->'messages') then raise exception 'INVALID_REVISE'; end if;
    v_index := 0;
    for v_msg in select value from jsonb_array_elements(v_new->'messages') loop
      v_index := v_index + 1;
      v_existing := (v_old->'messages')->(v_index - 1);
      v_old_draft := (v_existing->>'draftId')::uuid;
      select exists (select 1 from public.outbound_dispatches
        where draft_id = v_old_draft and status in ('sent', 'pending', 'sending', 'unknown', 'failed')) into v_locked;
      if v_locked then
        if v_msg->>'draftId' is distinct from v_existing->>'draftId'
          or v_msg->>'versionId' is distinct from v_existing->>'versionId'
          or v_msg->>'subject' is distinct from v_existing->>'subject'
          or v_msg->>'body' is distinct from v_existing->>'body'
          or (v_msg->>'delayDays')::integer is distinct from (v_existing->>'delayDays')::integer then
          raise exception 'INVALID_REVISE_LOCKED';
        end if;
      else
        if v_msg->>'draftId' = v_existing->>'draftId' then raise exception 'INVALID_REVISE_IDENTITY'; end if;
        if exists (select 1 from public.outbound_dispatches where draft_id = (v_msg->>'draftId')::uuid) then
          raise exception 'INVALID_REVISE_IDENTITY';
        end if;
        if length(trim(coalesce(v_msg->>'subject', ''))) not between 1 and 998
          or length(trim(coalesce(v_msg->>'body', ''))) not between 1 and 100000 then raise exception 'INVALID_REVISE'; end if;
        if (v_index = 1 and (v_msg->>'delayDays')::integer <> 0)
          or (v_index > 1 and ((v_msg->>'delayDays')::integer < 1 or (v_msg->>'delayDays')::integer > 90)) then
          raise exception 'INVALID_REVISE';
        end if;
        v_editable := v_editable + 1;
      end if;
    end loop;
  end loop;

  if p_drafts is null or jsonb_typeof(p_drafts) <> 'array' or jsonb_array_length(p_drafts) <> v_editable then
    raise exception 'INVALID_REVISE_DRAFTS';
  end if;
  for v_item in select value from jsonb_array_elements(p_drafts) loop
    v_payload := v_item->'payload';
    if v_payload->>'organizationId' is distinct from p_organization_id::text
      or v_payload->>'userId' is distinct from p_user_id::text
      or v_payload#>>'{approval,decidedBy}' is distinct from p_user_id::text
      or v_payload#>>'{approval,status}' is distinct from 'approved'
      or v_payload->>'lifecycle' is distinct from 'ready'
      or not exists (
        select 1 from jsonb_array_elements(p_recipients) r, jsonb_array_elements(r->'messages') m
        where r->>'email' = v_payload#>>'{recipient,email}' and m->>'draftId' = v_payload->>'draftId'
          and m->>'versionId' = v_payload->>'versionId' and m->>'subject' = v_payload#>>'{content,subject}'
          and m->>'body' = v_payload#>>'{content,text}' and v_payload#>'{content,html}' = 'null'::jsonb
      ) then raise exception 'INVALID_REVISE_DRAFTS'; end if;
    perform public.create_messaging_draft_v1(v_payload, v_item->>'hash');
  end loop;

  delete from public.bulk_campaign_attempts where campaign_id = p_id
    and draft_id not in (select (m->>'draftId')::uuid from jsonb_array_elements(p_recipients) r, jsonb_array_elements(r->'messages') m);

  update public.bulk_campaigns set definition = p_definition, recipients = p_recipients,
    review_hash = p_new_review_hash, revision = revision + 1, status = 'draft', approved_at = null, updated_at = now()
    where id = p_id returning * into v_campaign;
  return to_jsonb(v_campaign);
end;
$$;
revoke all on function public.revise_bulk_campaign_pending_v1(uuid, uuid, uuid, integer, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.revise_bulk_campaign_pending_v1(uuid, uuid, uuid, integer, text, text, jsonb, jsonb, jsonb) to service_role;
