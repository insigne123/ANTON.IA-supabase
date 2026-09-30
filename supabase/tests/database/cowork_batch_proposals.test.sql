begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(45);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values
  ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('f0000000-0000-4000-8000-000000000002', 'pgtap-cowork-batch-outsider@antonia.test', now());

insert into public.organizations (id, name)
values
  ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork batch'),
  ('f1000000-0000-4000-8000-000000000002', 'pgTAP Cowork batch outsider');

insert into public.organization_members (organization_id, user_id, role)
values
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner'),
  ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('f0000000-0000-4000-8000-000000000001', true);

-- Turn 1 runs under a live lease and proposes the batch. Turn 2 finished: it holds a staged
-- batch to show that the row goes away with its run.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000001', 'Invita a los de la lista', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000002', 'Escríbeles a los que aceptaron', 'approval', 'completed',
   null, null);

select has_table('public', 'cowork_batch_proposals', 'the staging table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_batch_proposals'::regclass), 'the staging table has RLS on');
select ok(not has_table_privilege('authenticated', 'public.cowork_batch_proposals', 'select')
  and not has_table_privilege('anon', 'public.cowork_batch_proposals', 'select')
  and not has_table_privilege('authenticated', 'public.cowork_batch_proposals', 'insert')
  and not has_table_privilege('authenticated', 'public.cowork_batch_proposals', 'update'),
  'no signed-in or anonymous account reads or writes staged batches');
select ok(has_table_privilege('service_role', 'public.cowork_batch_proposals', 'insert')
  and has_table_privilege('service_role', 'public.cowork_batch_proposals', 'select')
  and has_table_privilege('service_role', 'public.cowork_batch_proposals', 'update'),
  'the worker stages, reads and updates batches');

-- A batch of invitations: who is in it, once each, without a note, and the hash of the list.
select lives_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, deferred, patch_hash)
    values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch',
      '[{"id":"f6000000-0000-4000-8000-000000000001","name":"Marcela Rojas","company":"Servicios Norte","title":"Gerente de RR. HH."},
        {"id":"f6000000-0000-4000-8000-000000000002","name":"Héctor Vidal","company":"Casino Central","title":"Jefe de Personal"},
        {"id":"f6000000-0000-4000-8000-000000000003","name":"Ana Ruiz","company":"Alimentos del Valle","title":"Analista de Selección"}]'::jsonb,
      '[{"id":"f6000000-0000-4000-8000-000000000009","name":"Gerardo Paz","company":"Servicios Norte","reason":"otra persona de su empresa va hoy"}]'::jsonb,
      repeat('a', 64))$$,
  'a batch of invitations with its people, the one left for another day and its hash is staged'
);
select is((select excluded from public.cowork_batch_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'), '[]'::jsonb,
  'nobody is removed when it is staged');
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Otra"}]'::jsonb, repeat('b', 64))$$,
  '23505', null, 'one staged batch per run'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002',
      'linkedin_invite_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Otra"}]'::jsonb, repeat('c', 64))$$,
  '23503', null, 'a batch belongs to the owner and organization of its run'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_anything', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Otra"}]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'an unknown kind of batch is refused'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'a batch has at least one person'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch',
      (select jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'name', 'Persona ' || n)) from generate_series(1, 51) n),
      repeat('c', 64))$$,
  '23514', null, 'a batch holds 50 people at most'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[{"name":"Sin id"}]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'every person of a batch needs an id'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[{"id":"no-es-un-uuid","name":"Mala"}]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'the id of a person is a uuid'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch',
      '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Una"},{"id":"f6000000-0000-4000-8000-000000000004","name":"Otra vez"}]'::jsonb,
      repeat('c', 64))$$,
  '23514', null, 'a person appears once in a batch'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Con nota","message":"Hola"}]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'invitations go without a note'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_message_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Sin texto"}]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'every message of a batch needs its text'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_message_batch', jsonb_build_array(jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000004', 'name', 'Largo', 'message', repeat('x', 1201))),
      repeat('c', 64))$$,
  '23514', null, 'a message holds 1200 characters at most'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Otra"}]'::jsonb, 'no-es-un-hash')$$,
  '23514', null, 'the hash is 64 hex characters'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, excluded, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_invite_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Otra"}]'::jsonb,
      '["f6000000-0000-4000-8000-000000000004"]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'a batch is staged with everyone in it'
);
select lives_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_message_batch',
      '[{"id":"f6000000-0000-4000-8000-000000000011","name":"Marcela Rojas","company":"Servicios Norte","message":"Hola Marcela, gracias por aceptar."},
        {"id":"f6000000-0000-4000-8000-000000000012","name":"Héctor Vidal","company":"Casino Central","message":"Hola Héctor, gracias por aceptar."}]'::jsonb,
      repeat('d', 64))$$,
  'a batch of messages, each with its own text, is staged'
);

-- The live turn proposes the batch; the run then waits for the person's decision.
select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  'linkedin_invite_batch', 'f2000000-0000-4000-8000-000000000001', 'linkedinbatch:' || repeat('a', 64), 'Invitar a 3 personas en LinkedIn'),
  true, 'the lease holder proposes a batch of invitations');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  $$values ('linkedin_invite_batch'::text, 'proposed'::text, 'linkedinbatch:' || repeat('a', 64))$$,
  'the proposal is recorded as a batch of invitations'
);
select is((select status from public.cowork_runs where id = 'f2000000-0000-4000-8000-000000000001'), 'waiting_approval',
  'the turn waits for approval');
select throws_ok(
  $$select public.cowork_propose_effect('f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
    'linkedin_anything', 'f2000000-0000-4000-8000-000000000001', 'linkedinbatch:x', 'Invitar')$$,
  '22023', 'Unknown effect', 'an unknown effect is still refused'
);
select throws_ok(
  $$insert into public.cowork_effect_proposals (run_id, user_id, organization_id, kind, origin_run_id, target_id, label)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'linkedin_anything', 'f2000000-0000-4000-8000-000000000002', 'x', 'Invitar')$$,
  '23514', null, 'the table refuses an unknown effect too'
);

-- While it awaits the decision, people can be taken off the card, and only people of the batch.
select lives_ok(
  $$update public.cowork_batch_proposals set excluded = '["f6000000-0000-4000-8000-000000000002"]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  'a person is removed while the batch awaits the decision'
);
select is((select excluded from public.cowork_batch_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'),
  '["f6000000-0000-4000-8000-000000000002"]'::jsonb, 'the removed person is recorded');
select throws_ok(
  $$update public.cowork_batch_proposals set excluded = '["f6000000-0000-4000-8000-0000000000ff"]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'only people of the batch can be removed from it'
);
select throws_ok(
  $$update public.cowork_batch_proposals set excluded = '["f6000000-0000-4000-8000-000000000002","f6000000-0000-4000-8000-000000000002"]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a person is removed once'
);
select throws_ok(
  $$update public.cowork_batch_proposals set excluded = '[7]'::jsonb where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a removed person is an id, not anything else'
);
select throws_ok(
  $$update public.cowork_batch_proposals set items = '[{"id":"f6000000-0000-4000-8000-000000000077","name":"Alguien más"}]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the people of a staged batch never change'
);
select throws_ok(
  $$update public.cowork_batch_proposals set deferred = '[]'::jsonb where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the people left for another day never change'
);
select throws_ok(
  $$update public.cowork_batch_proposals set patch_hash = repeat('e', 64) where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the hash of a staged batch never changes'
);
select lives_ok(
  $$update public.cowork_batch_proposals set excluded = '[]'::jsonb where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  'a person put back on the card is included again while the batch awaits the decision'
);
update public.cowork_batch_proposals set excluded = '["f6000000-0000-4000-8000-000000000003"]'::jsonb
  where run_id = 'f2000000-0000-4000-8000-000000000001';

-- Once approved, the list of who is removed is frozen: an approval reaches exactly the people it was given for.
select is(public.cowork_resolve_effect('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', true),
  true, 'the owner approves the batch');
select is((select status from public.cowork_effect_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'), 'approved',
  'the proposal is approved');
select throws_ok(
  $$update public.cowork_batch_proposals set excluded = '[]'::jsonb where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'nobody is put back after the approval'
);
select throws_ok(
  $$update public.cowork_batch_proposals set excluded = '["f6000000-0000-4000-8000-000000000003","f6000000-0000-4000-8000-000000000001"]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'nobody else is removed after the approval'
);
select is((select excluded from public.cowork_batch_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'),
  '["f6000000-0000-4000-8000-000000000003"]'::jsonb, 'the removed list stands as it was approved');

-- One company a day: a LinkedIn job remembers the company it was queued for.
select has_column('public', 'cowork_linkedin_jobs', 'company_key', 'a LinkedIn job has a company key');
select lives_ok(
  $$insert into public.cowork_linkedin_jobs (user_id, organization_id, run_id, kind, canonical_url, profile_url, display_name, idempotency_key, company_key)
    values ('f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      'invite', 'https://www.linkedin.com/in/marcela-rojas', 'https://www.linkedin.com/in/marcela-rojas/', 'Marcela Rojas', repeat('1', 64), 'servicios norte')$$,
  'a job is queued with the company it is for'
);
select throws_ok(
  $$insert into public.cowork_linkedin_jobs (user_id, organization_id, run_id, kind, canonical_url, profile_url, display_name, idempotency_key, company_key)
    values ('f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      'invite', 'https://www.linkedin.com/in/hector-vidal', 'https://www.linkedin.com/in/hector-vidal/', 'Héctor Vidal', repeat('2', 64), '')$$,
  '23514', null, 'a company key is not empty'
);
select lives_ok(
  $$insert into public.cowork_linkedin_jobs (user_id, organization_id, run_id, kind, canonical_url, profile_url, display_name, idempotency_key)
    values ('f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
      'invite', 'https://www.linkedin.com/in/ana-ruiz', 'https://www.linkedin.com/in/ana-ruiz/', 'Ana Ruiz', repeat('3', 64))$$,
  'the jobs queued before the company key have none'
);
select has_index('public', 'cowork_linkedin_jobs', 'cowork_linkedin_jobs_company_day_idx', 'the company of the day is found by an index');

-- The staged batch goes away with its run.
delete from public.cowork_run_events where run_id = 'f2000000-0000-4000-8000-000000000002';
delete from public.cowork_runs where id = 'f2000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.cowork_batch_proposals where run_id = 'f2000000-0000-4000-8000-000000000002'), 0,
  'deleting the run deletes its staged batch');

select * from finish();
rollback;
