-- What a lookup costs is each organization's (20 Nov 2026). Until now every organization paid 1 credit for an email and 8 for a
-- phone, written in the code and in apollo_credit_allocation_status_v2. A customer's contract can say otherwise (5 for a phone,
-- 6 with its email), so the cost is a row here. An organization without a row is counted exactly as v2 counts it: 1, 8 and
-- the two added when both are asked.
create table if not exists public.organization_credit_prices (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  email_credits smallint not null default 1 check (email_credits between 0 and 100),
  phone_credits smallint not null default 8 check (phone_credits between 0 and 100),
  -- The email and the phone of a person asked together; null is the two added.
  both_credits smallint check (both_credits is null or both_credits between 0 and 200),
  -- Whether the organization's contract gives credits back for phones that do not exist (phone_refund_claims below).
  phone_refunds boolean not null default false,
  note text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.organization_credit_prices enable row level security;
-- Written by the ANTON.IA team and read by the server only: no client policy.
revoke all on table public.organization_credit_prices from public, anon, authenticated;
grant select, insert, update on table public.organization_credit_prices to service_role;
comment on table public.organization_credit_prices is
  'Credits an email and a phone cost an organization, and whether phones that do not exist are given back. No row: 1, 8 and no. Server only.';

-- Phones the customer says do not exist. The customer reports them (`reported`), the ANTON.IA team tries each number and
-- answers: `confirmed` gives back `credits` (what a phone cost the organization the day it was reported), `rejected` gives
-- nothing. A phone is reported once per organization. `phone` holds digits only.
create table if not exists public.phone_refund_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reported_by uuid references auth.users(id) on delete set null,
  phone text not null check (phone ~ '^[0-9]{7,15}$'),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  credits smallint not null check (credits between 0 and 100),
  status text not null default 'reported' check (status in ('reported', 'confirmed', 'rejected')),
  reported_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 300),
  constraint phone_refund_claims_review_check check ((status = 'reported') = (reviewed_at is null)),
  constraint phone_refund_claims_org_phone_key unique (organization_id, phone)
);
create index if not exists phone_refund_claims_org_reviewed_idx
  on public.phone_refund_claims (organization_id, reviewed_at) where status = 'confirmed';
alter table public.phone_refund_claims enable row level security;
revoke all on table public.phone_refund_claims from public, anon, authenticated;
grant select, insert, update on table public.phone_refund_claims to service_role;
comment on table public.phone_refund_claims is
  'Phones a customer reported as non-existent and what the ANTON.IA team answered. Confirmed ones give credits back. Server only.';

-- The organization's open allocation with its own prices and what was given back. `used` counts each lookup at the
-- organization's prices; the three price columns are null for an organization without its own, which is counted as v2
-- counts it. `refunded` is what was confirmed in this window plus what was confirmed in the window that closed right before
-- it and was not used there: credits given back can be used until the end of the window after theirs.
-- The server reads v3; v1 and v2 stay as they were.
create or replace function public.apollo_credit_allocation_status_v3(
  p_organization_id uuid,
  p_at timestamptz default now()
)
returns table (
  credits integer, used integer, remaining integer, starts_at timestamptz, ends_at timestamptz, note text,
  used_before integer, show_limit boolean, email_credits integer, phone_credits integer, both_credits integer, refunded integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with price as (
    -- Nulls when the organization has no prices of its own.
    select p.email_credits::integer as email_credits, p.phone_credits::integer as phone_credits,
      coalesce(p.both_credits, p.email_credits + p.phone_credits)::integer as both_credits
    from (select 1) one
    left join public.organization_credit_prices p on p.organization_id = p_organization_id
  ), allocation as (
    select sum(a.credits)::integer as credits, min(a.starts_at) as starts_at, max(a.ends_at) as ends_at,
      (array_agg(a.note order by a.created_at desc) filter (where a.note is not null))[1] as note,
      sum(a.used_before)::integer as used_before, bool_and(a.show_limit) as show_limit
    from public.apollo_credit_allocations a
    where a.organization_id = p_organization_id and a.starts_at <= p_at and a.ends_at > p_at
  ), spent as (
    select coalesce(sum(
      case when c.reveal_email and c.reveal_phone then coalesce(price.both_credits, 9)
        when c.reveal_phone then coalesce(price.phone_credits, 8)
        when c.reveal_email then coalesce(price.email_credits, 1) else 0 end
    ), 0)::integer as used
    from public.apollo_enrichment_callbacks c, allocation, price
    where c.organization_id = p_organization_id
      and c.created_at >= allocation.starts_at and c.created_at < allocation.ends_at
      and (c.terminal_state is null or c.terminal_state = 'succeeded')
  ), previous as (
    select sum(a.credits)::integer as credits, min(a.starts_at) as starts_at, max(a.ends_at) as ends_at
    from public.apollo_credit_allocations a, allocation
    where a.organization_id = p_organization_id
      and a.ends_at <= allocation.starts_at and a.ends_at > allocation.starts_at - interval '3 days'
  ), previous_use as (
    select
      coalesce((select sum(
        case when c.reveal_email and c.reveal_phone then coalesce(price.both_credits, 9)
          when c.reveal_phone then coalesce(price.phone_credits, 8)
          when c.reveal_email then coalesce(price.email_credits, 1) else 0 end)
        from public.apollo_enrichment_callbacks c
        where c.organization_id = p_organization_id
          and c.created_at >= previous.starts_at and c.created_at < previous.ends_at
          and (c.terminal_state is null or c.terminal_state = 'succeeded')), 0)::integer as used,
      coalesce((select sum(r.credits) from public.phone_refund_claims r
        where r.organization_id = p_organization_id and r.status = 'confirmed'
          and r.reviewed_at >= previous.starts_at and r.reviewed_at < previous.ends_at), 0)::integer as refunded
    from previous, price
  ), returned as (
    select (
      coalesce((select sum(r.credits) from public.phone_refund_claims r
        where r.organization_id = p_organization_id and r.status = 'confirmed'
          and r.reviewed_at >= allocation.starts_at and r.reviewed_at < allocation.ends_at), 0)
      + coalesce(least(previous_use.refunded, greatest(previous.credits + previous_use.refunded - previous_use.used, 0)), 0)
    )::integer as refunded
    from allocation, previous, previous_use
  )
  select allocation.credits, spent.used, greatest(allocation.credits + returned.refunded - spent.used, 0), allocation.starts_at,
    allocation.ends_at, allocation.note, allocation.used_before, allocation.show_limit, price.email_credits, price.phone_credits,
    price.both_credits, returned.refunded
  from allocation, spent, price, returned
  where allocation.credits is not null;
$$;

revoke all on function public.apollo_credit_allocation_status_v3(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apollo_credit_allocation_status_v3(uuid, timestamptz) to service_role;
