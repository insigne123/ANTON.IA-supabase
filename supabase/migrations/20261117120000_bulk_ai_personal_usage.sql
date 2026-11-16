-- Campaigns where every recipient gets emails written for them (17 Nov 2026, src/lib/bulk-campaign-personal.ts). Writing them is a
-- call or two to the model per person, so each user has a number of people a day (600 unless BULK_AI_PERSONAL_DAILY_LIMIT says
-- otherwise), counted apart from the campaign assists (bulk_ai_assist_usage, 50 a day): one campaign of a hundred would use those up.
--
-- consume_bulk_ai_personal_v1 adds `p_amount` people to the day and returns how many are left, or -1 without adding anything when
-- they do not fit. Server only (service_role), as the assists' budget: row security is on with no policy. Forward-only and inert on
-- its own; the app tolerates its absence (src/lib/server/bulk-ai-budget.ts).
create table if not exists public.bulk_ai_personal_usage (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (organization_id, user_id, day)
);
alter table public.bulk_ai_personal_usage enable row level security;
revoke all on table public.bulk_ai_personal_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.bulk_ai_personal_usage to service_role;
comment on table public.bulk_ai_personal_usage is
  'People a user had campaign emails written for with AI on a day (consume_bulk_ai_personal_v1). Server only.';

create or replace function public.consume_bulk_ai_personal_v1(p_organization_id uuid, p_user_id uuid, p_day date, p_amount integer, p_limit integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' or not exists (
    select 1 from public.organization_members where organization_id = p_organization_id and user_id = p_user_id
  ) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_amount is null or p_amount < 1 then raise exception 'INVALID_AI_BUDGET'; end if;
  insert into public.bulk_ai_personal_usage(organization_id, user_id, day, count)
    values (p_organization_id, p_user_id, p_day, 0)
    on conflict (organization_id, user_id, day) do nothing;
  update public.bulk_ai_personal_usage set count = count + p_amount
    where organization_id = p_organization_id and user_id = p_user_id and day = p_day and count + p_amount <= p_limit
    returning count into v_count;
  if v_count is null then return -1; end if;
  return p_limit - v_count;
end;
$$;
revoke all on function public.consume_bulk_ai_personal_v1(uuid, uuid, date, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_bulk_ai_personal_v1(uuid, uuid, date, integer, integer) to service_role;
