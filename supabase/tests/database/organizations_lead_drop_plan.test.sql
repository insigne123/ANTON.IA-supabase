begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(11);

insert into auth.users (id, email) values ('d7000000-0000-4000-8000-000000000001', 'drop-plan-owner@antonia.test');
insert into public.organizations (id, name) values ('d7100000-0000-4000-8000-000000000001', 'Drop Plan Team');
insert into public.organization_members (organization_id, user_id, role)
values ('d7100000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001', 'owner');

select is(
  (select lead_drop_size::int from public.organizations where id = 'd7100000-0000-4000-8000-000000000001'), 1,
  'a team starts with one contact'
);
select is(
  (select lead_drop_weekdays::int[] from public.organizations where id = 'd7100000-0000-4000-8000-000000000001'), array[2, 3, 5],
  'on Tuesdays, Wednesdays and Fridays'
);

-- Whoever operates the database (and the server) sets what a team contracted.
select lives_ok(
  $$update public.organizations set lead_drop_size = 6, lead_drop_weekdays = '{1,2,3,4,5}' where id = 'd7100000-0000-4000-8000-000000000001'$$,
  'the operator sets six contacts every working day'
);
select throws_ok(
  $$update public.organizations set lead_drop_size = 11 where id = 'd7100000-0000-4000-8000-000000000001'$$,
  '23514', null, 'never more than ten contacts'
);
select throws_ok(
  $$update public.organizations set lead_drop_weekdays = '{}' where id = 'd7100000-0000-4000-8000-000000000001'$$,
  '23514', null, 'never without a day'
);
select throws_ok(
  $$update public.organizations set lead_drop_weekdays = '{5,6}' where id = 'd7100000-0000-4000-8000-000000000001'$$,
  '23514', null, 'never on a weekend'
);

-- A person of the team, through the API, cannot change it; the rest of their row they still can.
select set_config('request.jwt.claim.sub', 'd7000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$update public.organizations set lead_drop_size = 10 where id = 'd7100000-0000-4000-8000-000000000001'$$,
  '42501', 'The lead drop plan is service-owned', 'an owner cannot give their team more contacts'
);
select throws_ok(
  $$update public.organizations set lead_drop_weekdays = '{1}' where id = 'd7100000-0000-4000-8000-000000000001'$$,
  '42501', 'The lead drop plan is service-owned', 'nor change its days'
);
select lives_ok(
  $$update public.organizations set name = 'Drop Plan Team Renamed', lead_drop_size = 6 where id = 'd7100000-0000-4000-8000-000000000001'$$,
  'an update that leaves the plan as it is goes through'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select is(
  (select lead_drop_size::int from public.organizations where id = 'd7100000-0000-4000-8000-000000000001'), 6,
  'the plan is what the operator set'
);
select is(
  has_function_privilege('authenticated', 'public.guard_organization_lead_drop_plan_v1()', 'execute'), false,
  'people cannot call the guard directly'
);

select * from finish();
rollback;
