begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

select ok((select relrowsecurity from pg_class where oid = 'public.lead_drops'::regclass), 'lead_drops has RLS');
select ok(not has_table_privilege('authenticated', 'public.lead_drops', 'select'), 'session clients go through the server');
select ok(not has_table_privilege('anon', 'public.lead_drops', 'select'), 'anon cannot read the drops');

insert into public.organizations (id, name) values ('d5000000-0000-4000-8000-000000000001', 'pgtap drops');
insert into auth.users (id, email) values ('d6000000-0000-4000-8000-000000000001', 'pgtap-drops@example.com');
insert into public.lead_drops (organization_id, user_id, drop_date, status, items)
values ('d5000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', '2026-10-20', 'pending', '[]');
select throws_ok(
  $$insert into public.lead_drops (organization_id, user_id, drop_date, status)
    values ('d5000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', '2026-10-20', 'ready')$$,
  '23505', null, 'one drop per person, organization and day');
select throws_ok(
  $$insert into public.lead_drops (organization_id, user_id, drop_date, status, items)
    values ('d5000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', '2026-10-23', 'ready', '{}')$$,
  '23514', null, 'items is a list');
delete from auth.users where id = 'd6000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.lead_drops where user_id = 'd6000000-0000-4000-8000-000000000001'), 0, 'drops go with the person');

select * from finish();
rollback;
