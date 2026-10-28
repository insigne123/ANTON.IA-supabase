-- What the admin panel shows of an organization's Apollo share (follows 20261028230000). `used_before` is what the
-- organization had used earlier in the cycle, shown with the window's use (it limits nothing); `show_limit` false shows it
-- only what it used, not its share nor what is left. The server reads v2; v1 counts the same and stays as it was.
alter table public.apollo_credit_allocations
  add column if not exists used_before integer not null default 0 check (used_before between 0 and 1000000),
  add column if not exists show_limit boolean not null default true;

create or replace function public.apollo_credit_allocation_status_v2(
  p_organization_id uuid,
  p_at timestamptz default now()
)
returns table (
  credits integer, used integer, remaining integer, starts_at timestamptz, ends_at timestamptz, note text,
  used_before integer, show_limit boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with allocation as (
    select sum(a.credits)::integer as credits, min(a.starts_at) as starts_at, max(a.ends_at) as ends_at,
      (array_agg(a.note order by a.created_at desc) filter (where a.note is not null))[1] as note,
      sum(a.used_before)::integer as used_before, bool_and(a.show_limit) as show_limit
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
    allocation.ends_at, allocation.note, allocation.used_before, allocation.show_limit
  from allocation, spent
  where allocation.credits is not null;
$$;

revoke all on function public.apollo_credit_allocation_status_v2(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.apollo_credit_allocation_status_v2(uuid, timestamptz) to service_role;
