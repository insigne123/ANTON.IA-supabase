begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(10);

select has_table('public', 'contact_touches', 'contact_touches exists');
select ok((select relrowsecurity from pg_class where oid = 'public.contact_touches'::regclass), 'contact_touches has RLS');
select ok(not has_table_privilege('anon', 'public.contact_touches', 'select'), 'anon cannot read touches');
select ok(not has_table_privilege('authenticated', 'public.contact_touches', 'select'), 'session clients go through the server');
select ok(has_table_privilege('service_role', 'public.contact_touches', 'insert'), 'the server writes them');

-- One touch per contact and rule, with the channels, keys and outcomes the app knows.
insert into public.organizations (id, name) values ('c1000000-0000-4000-8000-000000000001', 'pgtap touches');
insert into auth.users (id, email) values ('c2000000-0000-4000-8000-000000000001', 'pgtap-touches@example.com');
insert into public.contacted_leads (id, user_id, organization_id) values ('pgtap-touch-1', 'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001');
insert into public.contact_touches (organization_id, user_id, contacted_id, rule_key, channel, due_at)
values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'pgtap-touch-1', 'call:3', 'call', now());
select throws_ok(
  $$insert into public.contact_touches (organization_id, user_id, contacted_id, rule_key, channel, due_at)
    values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'pgtap-touch-1', 'call:3', 'call', now())$$,
  '23505', null, 'a rule creates one touch per contact');
select throws_ok(
  $$insert into public.contact_touches (organization_id, user_id, contacted_id, rule_key, channel, due_at)
    values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'pgtap-touch-1', 'whatsapp:2', 'call', now())$$,
  '23514', null, 'only call, linkedin and manual keys');
select throws_ok(
  $$update public.contact_touches set state = 'done', outcome = 'ghosted' where contacted_id = 'pgtap-touch-1'$$,
  '23514', null, 'only the outcomes the app offers');
select lives_ok(
  $$update public.contact_touches set state = 'done', outcome = 'talked', call_summary = '{"summary":"Habló de su dotación."}' where contacted_id = 'pgtap-touch-1'$$,
  'a call keeps its summary');

-- Deleting the contact takes its touches with it.
delete from public.contacted_leads where id = 'pgtap-touch-1';
select is((select count(*)::int from public.contact_touches where contacted_id = 'pgtap-touch-1'), 0, 'touches go with the contact');

select * from finish();
rollback;
