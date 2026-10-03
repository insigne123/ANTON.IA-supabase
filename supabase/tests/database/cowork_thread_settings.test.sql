begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(13);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values ('e0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('e0000000-0000-4000-8000-000000000002', 'pgtap-cowork-threads-outsider@antonia.test', now());
insert into public.organizations (id, name) values ('e1000000-0000-4000-8000-000000000001', 'pgTAP Cowork hilos');
insert into public.organization_members (organization_id, user_id, role)
values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'owner'),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'member');
insert into public.cowork_access_grants (user_id, enabled) values ('e0000000-0000-4000-8000-000000000001', true);
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status)
values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001', '¿A quién le escribo esta semana?', 'approval', 'completed');

select has_table('public', 'cowork_thread_settings', 'the settings of a conversation have their table');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_thread_settings'::regclass), 'with RLS on');
select ok(has_table_privilege('authenticated', 'public.cowork_thread_settings', 'select')
  and not has_table_privilege('authenticated', 'public.cowork_thread_settings', 'insert')
  and not has_table_privilege('authenticated', 'public.cowork_thread_settings', 'update')
  and not has_table_privilege('authenticated', 'public.cowork_thread_settings', 'delete')
  and not has_table_privilege('anon', 'public.cowork_thread_settings', 'select'),
  'signed-in accounts only read it; anonymous visitors get nothing');

select lives_ok($$
  insert into public.cowork_thread_settings (root_run_id, user_id, organization_id, title)
  values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Prospectos de retail')
$$, 'the server names a conversation');
select throws_ok($$
  insert into public.cowork_thread_settings (root_run_id, user_id, organization_id)
  values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001')
$$, '23505', null, 'one row per conversation');
select throws_ok($$
  update public.cowork_thread_settings set title = '' where root_run_id = 'e2000000-0000-4000-8000-000000000001'
$$, '23514', null, 'a name is never empty');
select throws_ok($$
  update public.cowork_thread_settings set title = '  Retail  ' where root_run_id = 'e2000000-0000-4000-8000-000000000001'
$$, '23514', null, 'a name is stored trimmed');
select throws_ok($$
  update public.cowork_thread_settings set title = repeat('x', 121) where root_run_id = 'e2000000-0000-4000-8000-000000000001'
$$, '23514', null, 'a name has at most 120 characters');
select lives_ok($$
  update public.cowork_thread_settings set title = null, hidden_at = now() where root_run_id = 'e2000000-0000-4000-8000-000000000001'
$$, 'a conversation can go back to its first message as name, and be hidden');
select throws_ok($$
  insert into public.cowork_thread_settings (root_run_id, user_id, organization_id, title)
  values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Ajeno')
$$, null, null, 'nobody names someone else''s conversation');

-- The owner reads their row; another member of the organization sees nothing.
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.cowork_thread_settings), 1, 'the owner reads the settings of their conversation');
reset role;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is_empty($$select 1 from public.cowork_thread_settings$$, 'another member sees no settings');
reset role;

delete from public.cowork_run_events where run_id = 'e2000000-0000-4000-8000-000000000001';
delete from public.cowork_runs where id = 'e2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.cowork_thread_settings), 0, 'the settings go away with their conversation');

select * from finish();
rollback;
