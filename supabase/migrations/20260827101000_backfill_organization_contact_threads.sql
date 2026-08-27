-- This bounded backfill runs before any organization can be enabled. The
-- migration session bypasses row triggers only for the immutable historical
-- link update; concurrent application sessions keep all triggers enabled.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

with normalized_dispatches as (
  select
    od.id,
    od.organization_id,
    od.user_id,
    lower(trim(od.metadata #>> '{recipient,email}')) as recipient_email,
    case
      when od.metadata #>> '{recipient,leadRef}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (od.metadata #>> '{recipient,leadRef}')::uuid
      else null
    end as lead_id,
    case
      when crs.id is not null then crs.campaign_id::text
      when od.idempotency_key ~* '^campaign:[^:]+:' then split_part(od.idempotency_key, ':', 2)
      else null
    end as campaign_id,
    coalesce(od.completed_at, od.updated_at, od.created_at) as contacted_at
  from public.outbound_dispatches od
  left join public.campaign_recipient_steps crs
    on crs.id = od.campaign_recipient_step_id
   and crs.organization_id = od.organization_id
  where od.status = 'sent'
    and od.channel = 'email'
    and lower(trim(coalesce(od.metadata #>> '{recipient,email}', '')))
      ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
), roots as (
  select distinct on (organization_id, recipient_email) *
  from normalized_dispatches
  order by organization_id, recipient_email, contacted_at, id
), latest as (
  select distinct on (organization_id, recipient_email) *
  from normalized_dispatches
  order by organization_id, recipient_email, contacted_at desc, id desc
)
insert into public.organization_contact_threads (
  organization_id, channel, recipient_key, recipient_email, status,
  active_lead_id, active_campaign_id, opened_by_user_id, last_sent_by_user_id,
  root_dispatch_id, first_contacted_at, last_contacted_at, created_at, updated_at
)
select
  roots.organization_id, 'email', roots.recipient_email, roots.recipient_email, 'active',
  roots.lead_id, roots.campaign_id, roots.user_id, latest.user_id,
  roots.id, roots.contacted_at, latest.contacted_at, roots.contacted_at, latest.contacted_at
from roots
join latest using (organization_id, recipient_email)
on conflict (organization_id, channel, recipient_key) do nothing;

set local session_replication_role = replica;

update public.outbound_dispatches od
set contact_thread_id = oct.id
from public.organization_contact_threads oct
where od.contact_thread_id is null
  and od.status = 'sent'
  and od.channel = 'email'
  and oct.organization_id = od.organization_id
  and oct.channel = 'email'
  and oct.recipient_key = lower(trim(od.metadata #>> '{recipient,email}'));

set local session_replication_role = origin;

update public.organization_lead_collaboration olc
set contact_state = 'contacted'
from public.organization_contact_threads oct
where oct.active_lead_id = olc.lead_id
  and oct.organization_id = olc.organization_id
  and oct.status = 'active'
  and olc.contact_state in ('uncontacted', 'reserved');

do $$
begin
  if exists (
    select 1
    from public.outbound_dispatches od
    where od.status = 'sent'
      and od.channel = 'email'
      and lower(trim(coalesce(od.metadata #>> '{recipient,email}', '')))
        ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and od.contact_thread_id is null
  ) then
    raise exception 'confirmed outbound dispatches remain unlinked' using errcode = '55000';
  end if;
end;
$$;
