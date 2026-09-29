begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(18);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values
  ('c0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('c0000000-0000-4000-8000-000000000002', 'pgtap-cowork-outsider@antonia.test', now());

insert into public.organizations (id, name)
values
  ('c1000000-0000-4000-8000-000000000001', 'pgTAP Cowork'),
  ('c1000000-0000-4000-8000-000000000002', 'pgTAP Cowork Outsider');

insert into public.organization_members (organization_id, user_id, role)
values
  ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'owner'),
  ('c1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('c0000000-0000-4000-8000-000000000001', true);

-- A running turn with a live lease, one whose lease expired, and a finished one.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-000000000001', 'Escríbele a mis contactos de RR. HH.', 'approval', 'running',
   'c4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('c2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-000000000002', '¿Cómo voy?', 'approval', 'running',
   'c4000000-0000-4000-8000-000000000002', now() - interval '1 second'),
  ('c2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
   'c3000000-0000-4000-8000-000000000003', '¿A quién le escribo hoy?', 'approval', 'completed',
   'c4000000-0000-4000-8000-000000000003', now() + interval '2 minutes');

select has_table('public', 'cowork_run_drafts', 'the draft table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_run_drafts'::regclass), 'drafts have RLS on');

-- Only the worker holding the lease of a running turn writes, and each write replaces the last.
select is(public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'Hola', '{"blocks": 1}'),
  true, 'the lease holder writes the draft');
select is(public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'Hola Felipe,', '{}'),
  true, 'a second write succeeds');
select results_eq(
  $$select text, progress from public.cowork_run_drafts where run_id = 'c2000000-0000-4000-8000-000000000001'$$,
  $$values ('Hola Felipe,'::text, '{}'::jsonb)$$,
  'the second write replaces the first'
);
select is((select count(*)::integer from public.cowork_run_drafts), 1, 'one row per run');
select is(public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-00000000000f', 'Otro texto'),
  false, 'a wrong lease token writes nothing');
select is(public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'Tarde'),
  false, 'an expired lease writes nothing');
select is(public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000003', 'c4000000-0000-4000-8000-000000000003', 'Terminado'),
  false, 'a finished turn takes no draft');
select is((select text from public.cowork_run_drafts where run_id = 'c2000000-0000-4000-8000-000000000001'), 'Hola Felipe,',
  'refused writes leave the draft as it was');
select throws_ok(
  $$select public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', repeat('a', 20001))$$,
  '22001', null, 'a draft over 20 000 characters is refused'
);
select throws_ok(
  $$select public.cowork_write_run_draft('c2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'Hola', '[1, 2]')$$,
  '22023', null, 'progress must be an object'
);
select ok(not has_function_privilege('authenticated', 'public.cowork_write_run_draft(uuid, uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.cowork_write_run_draft(uuid, uuid, text, jsonb)', 'execute'),
  'only the service role can write drafts');

-- The owner reads the draft of their turn; nobody else sees it or writes it directly.
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select results_eq(
  $$select text from public.cowork_run_drafts where run_id = 'c2000000-0000-4000-8000-000000000001'$$,
  $$values ('Hola Felipe,'::text)$$,
  'the owner reads the live draft'
);
select throws_ok(
  $$update public.cowork_run_drafts set text = 'otro' where run_id = 'c2000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'the owner cannot change a draft directly'
);
reset role;

select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is_empty($$select 1 from public.cowork_run_drafts$$, 'another account sees no drafts');
reset role;

-- The draft goes away with its run.
delete from public.cowork_run_events where run_id = 'c2000000-0000-4000-8000-000000000001';
delete from public.cowork_runs where id = 'c2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.cowork_run_drafts), 0, 'deleting the run deletes its draft');
select is((select count(*)::integer from public.cowork_runs where id = 'c2000000-0000-4000-8000-000000000001'), 0, 'the run is gone');

select * from finish();
rollback;
