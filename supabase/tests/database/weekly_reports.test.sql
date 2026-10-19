begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

select ok((select relrowsecurity from pg_class where oid = 'public.weekly_reports'::regclass), 'weekly_reports has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_report_roles'::regclass), 'organization_report_roles has RLS');
select ok(not has_table_privilege('authenticated', 'public.weekly_reports', 'select'), 'session clients go through the server');
select ok(not has_table_privilege('anon', 'public.organization_report_roles', 'select'), 'anon cannot read the managers');

insert into public.organizations (id, name) values ('d1000000-0000-4000-8000-000000000001', 'pgtap weekly');
insert into auth.users (id, email) values ('d2000000-0000-4000-8000-000000000001', 'pgtap-weekly@example.com');
insert into public.weekly_reports (organization_id, user_id, week_start, payload)
values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', '2026-10-12', '{"week":{}}');
select throws_ok(
  $$insert into public.weekly_reports (organization_id, user_id, week_start, payload)
    values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', '2026-10-12', '{}')$$,
  '23505', null, 'one report per person, organization and week');
select throws_ok(
  $$insert into public.weekly_reports (organization_id, user_id, week_start, payload)
    values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', '2026-10-14', '{}')$$,
  '23514', null, 'a week starts on Monday');
select throws_ok(
  $$insert into public.organization_report_roles (organization_id, user_id, role)
    values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'boss')$$,
  '23514', null, 'only the roles the app knows');
select lives_ok(
  $$insert into public.organization_report_roles (organization_id, user_id, role)
    values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'opportunities')$$,
  'an opportunities manager');
delete from auth.users where id = 'd2000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.weekly_reports where user_id = 'd2000000-0000-4000-8000-000000000001'), 0, 'reports go with the person');

select * from finish();
rollback;
