-- Apollo credits split between organizations for a window. The shared Apollo account is one balance for every company;
-- when credits are bought for some of them (28 Oct 2026: the cycle's plan was spent and more were bought for two
-- companies), each one gets its share here. While an organization has an open allocation, its email and phone lookups
-- stop when its share is used. Searches are not counted and are never stopped by this.
create table if not exists public.apollo_credit_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  credits integer not null check (credits between 1 and 100000),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  constraint apollo_credit_allocations_window_check check (ends_at > starts_at)
);

create index if not exists apollo_credit_allocations_org_window_idx
  on public.apollo_credit_allocations (organization_id, ends_at);

alter table public.apollo_credit_allocations enable row level security;
-- Written by the ANTON.IA team and read by the server only: no client policy.
revoke all on table public.apollo_credit_allocations from public, anon, authenticated;
grant select, insert, update on table public.apollo_credit_allocations to service_role;

-- The window's lookups of one organization, read on every enrichment while an allocation is open.
create index if not exists apollo_enrichment_callbacks_org_created_idx
  on public.apollo_enrichment_callbacks (organization_id, created_at);

-- What the organization's open allocation has left. A lookup counts what Apollo charges when it returns the data
-- (1 credit for the email, 8 for the phone) once it succeeded, and is reserved while it is still waiting; one that found
-- nothing, failed or was cancelled counts nothing. No row when the organization has no open allocation.
create or replace function public.apollo_credit_allocation_status_v1(
  p_organization_id uuid,
  p_at timestamptz default now()
)
returns table (credits integer, used integer, remaining integer, starts_at timestamptz, ends_at timestamptz, note text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with allocation as (
    select sum(a.credits)::integer as credits, min(a.starts_at) as starts_at, max(a.ends_at) as ends_at,
      (array_agg(a.note order by a.created_at desc) filter (where a.note is not null))[1] as note
    from public.apollo_credit_allocations a
    where a.organization_id = p_organization_id and a.starts_at <= p_at and a.ends_at > p_at
  ), spent as (
    select coalesce(sum(
      (case when c.reveal_email then 1 else 0 end) + (case when c.reveal_phone then 8 else 0 end)
    ), 0)::integer as used
    from public.apollo_enrichment_callbacks c, allocation
    where c.organization_id = p_organization_id
      and c.created_at >= allocation.starts_at and c.created_at < allocation.ends_at
      and (c.terminal_state is null or c.terminal_state = 'succeeded')
  )
  select allocation.credits, spent.used, greatest(allocation.credits - spent.used, 0), allocation.starts_at,
    allocation.ends_at, allocation.note
  from allocation, spent
  where allocation.credits is not null;
$$;

revoke all on function public.apollo_credit_allocation_status_v1(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apollo_credit_allocation_status_v1(uuid, timestamptz) to service_role;
