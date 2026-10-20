begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(10);

select ok((select relrowsecurity from pg_class where oid = 'public.weekly_goals'::regclass), 'weekly_goals has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.daily_alerts'::regclass), 'daily_alerts has RLS');
select ok(not has_table_privilege('authenticated', 'public.weekly_goals', 'select'), 'session clients go through the server');
select ok(not has_table_privilege('anon', 'public.daily_alerts', 'select'), 'anon cannot read the alerts');

insert into public.organizations (id, name) values ('d3000000-0000-4000-8000-000000000001', 'pgtap goals');
insert into auth.users (id, email) values ('d4000000-0000-4000-8000-000000000001', 'pgtap-goals@example.com');
insert into public.weekly_goals (organization_id, user_id, found, contacted)
values ('d3000000-0000-4000-8000-000000000001', null, 15, 10);
select throws_ok(
  $$insert into public.weekly_goals (organization_id, user_id, found, contacted)
    values ('d3000000-0000-4000-8000-000000000001', null, 20, 12)$$,
  '23505', null, 'one goal per team');
select lives_ok(
  $$insert into public.weekly_goals (organization_id, user_id, found, contacted)
    values ('d3000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', 30, 20)
    on conflict (organization_id, user_id) do update set found = excluded.found$$,
  'and one per person, besides the team''s');
select throws_ok(
  $$insert into public.weekly_goals (organization_id, user_id, found, contacted)
    values ('d3000000-0000-4000-8000-000000000001', null, 501, 10)
    on conflict (organization_id, user_id) do update set found = excluded.found$$,
  '23514', null, 'goals stay within 0 and 500');
insert into public.daily_alerts (organization_id, user_id, alert_date, status, payload)
values ('d3000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', '2026-10-21', 'quiet', '{"items":[]}');
select throws_ok(
  $$insert into public.daily_alerts (organization_id, user_id, alert_date, status, payload)
    values ('d3000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', '2026-10-21', 'sent', '{}')$$,
  '23505', null, 'one alert per person, organization and day');
select throws_ok(
  $$insert into public.daily_alerts (organization_id, user_id, alert_date, status, payload)
    values ('d3000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001', '2026-10-22', 'spam', '{}')$$,
  '23514', null, 'only the states the app knows');
delete from auth.users where id = 'd4000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.daily_alerts where user_id = 'd4000000-0000-4000-8000-000000000001'), 0, 'alerts go with the person');

select * from finish();
rollback;
