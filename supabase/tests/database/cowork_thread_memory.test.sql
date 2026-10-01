begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

insert into auth.users (id, email, email_confirmed_at)
values ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('f0000000-0000-4000-8000-000000000002', 'pgtap-cowork-memory-outsider@antonia.test', now());
insert into public.organizations (id, name) values ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork memoria');
insert into public.organization_members (organization_id, user_id, role)
values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner');
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status)
values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001', 'Quiero vender revisión de antecedentes', 'approval', 'completed');

select has_table('public', 'cowork_thread_memory', 'the memory of a conversation has its table');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_thread_memory'::regclass), 'with RLS on');
select ok(not has_table_privilege('authenticated', 'public.cowork_thread_memory', 'select')
  and not has_table_privilege('anon', 'public.cowork_thread_memory', 'select')
  and not has_table_privilege('authenticated', 'public.cowork_thread_memory', 'insert'),
  'no signed-in or anonymous account reads or writes it');

select lives_ok($$
  insert into public.cowork_thread_memory (root_run_id, user_id, organization_id, memory, source_run_id, source_created_at)
  values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
    '{"offer":"Revisión de antecedentes","audience":null,"people":[],"decisions":[],"pending":[]}', 'f2000000-0000-4000-8000-000000000001', now())
$$, 'the worker keeps the memory of a conversation');
select throws_ok($$
  insert into public.cowork_thread_memory (root_run_id, user_id, organization_id, memory, source_run_id, source_created_at)
  values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
    '{}', 'f2000000-0000-4000-8000-000000000001', now())
$$, '23505', null, 'one memory per conversation');
select throws_ok($$
  insert into public.cowork_thread_memory (root_run_id, user_id, organization_id, memory, source_run_id, source_created_at)
  values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001',
    '{}', 'f2000000-0000-4000-8000-000000000001', now())
$$, null, null, 'nobody else keeps a memory on someone''s conversation');
select throws_ok($$
  update public.cowork_thread_memory set memory = '["no es un objeto"]' where root_run_id = 'f2000000-0000-4000-8000-000000000001'
$$, '23514', null, 'a memory is an object');
select throws_ok($$
  update public.cowork_thread_memory set memory = jsonb_build_object('offer', repeat('x', 13000)) where root_run_id = 'f2000000-0000-4000-8000-000000000001'
$$, '23514', null, 'and a short one');

delete from public.cowork_runs where id = 'f2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.cowork_thread_memory), 0, 'it goes away with its conversation');

select * from finish();
rollback;
