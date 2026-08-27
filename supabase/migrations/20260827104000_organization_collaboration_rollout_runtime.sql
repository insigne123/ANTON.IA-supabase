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
    ),
    'unlinkedConfirmedDispatchCount', (
      select count(*) from public.outbound_dispatches
      where organization_id = p_organization_id
        and channel = 'email'
        and status = 'sent'
        and lower(trim(coalesce(metadata #>> '{recipient,email}', '')))
          ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and contact_thread_id is null
    ),
    'invalidConfirmedRecipientCount', (
      select count(*) from public.outbound_dispatches
      where organization_id = p_organization_id
        and channel = 'email'
        and status = 'sent'
        and lower(trim(coalesce(metadata #>> '{recipient,email}', '')))
          !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
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

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'organization-collaboration-rollout:', p_organization_id::text
  ), 0));

  v_report := public.organization_collaboration_rollout_report_v1(p_organization_id);
  if p_enabled and (
    coalesce((v_report ->> 'ambiguousRecipientCount')::bigint, 0) > 0
    or coalesce((v_report ->> 'inFlightOrUnknownDispatchCount')::bigint, 0) > 0
    or coalesce((v_report ->> 'unlinkedConfirmedDispatchCount')::bigint, 0) > 0
    or coalesce((v_report ->> 'invalidConfirmedRecipientCount')::bigint, 0) > 0
  ) then
    raise exception 'Organization collaboration rollout checks failed' using errcode = '55000';
  end if;

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

revoke all on function public.organization_collaboration_rollout_report_v1(uuid) from public, anon, authenticated;
revoke all on function public.set_organization_collaboration_v1_enabled(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.organization_collaboration_rollout_report_v1(uuid) to service_role;
grant execute on function public.set_organization_collaboration_v1_enabled(uuid, boolean, text) to service_role;

notify pgrst, 'reload schema';
