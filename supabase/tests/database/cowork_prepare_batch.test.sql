begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

-- The verified owner (the only Cowork account today).
insert into auth.users (id, email, email_confirmed_at)
values ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now());

insert into public.organizations (id, name)
values ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork preparar contactos');

insert into public.organization_members (organization_id, user_id, role)
values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('f0000000-0000-4000-8000-000000000001', true);

-- Two turns under a live lease: the first proposes «preparar contactos», the second an effect accepted before.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000001', 'Guarda a los dos, busca sus correos e investígalos', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000002', 'Revela el teléfono de Marcela', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000002', now() + interval '2 minutes');

-- The staged list: each person with only the steps still missing for them.
select lives_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, deferred, patch_hash)
    values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'lead_prepare_batch',
      '[{"id":"f6000000-0000-4000-8000-000000000001","providerId":"apollo:rafael","name":"Rafael Du***n","company":"R&D Montajes","title":"Jefe de Operaciones","steps":["save","enrich","research"],"done":[]},
        {"id":"f6000000-0000-4000-8000-000000000002","name":"Susana Cáceres","company":"MSTI","title":"Human Resources Manager","steps":["research"],"done":["save","enrich"]}]'::jsonb,
      '[{"id":"f6000000-0000-4000-8000-000000000003","name":"Ana Pérez","company":"Acme","reason":"Ya está guardado, con su correo buscado y su investigación hecha o en curso."}]'::jsonb,
      repeat('a', 64))$$,
  'a batch to prepare contacts is staged with each person and what they still need'
);

select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  'lead_prepare_batch', 'f2000000-0000-4000-8000-000000000001', 'preparebatch:' || repeat('a', 64), 'Preparar a 2 personas: guardar, buscar su correo e investigar'),
  true, 'the lease holder proposes preparing the contacts');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  $$values ('lead_prepare_batch'::text, 'proposed'::text, 'preparebatch:' || repeat('a', 64))$$,
  'the proposal is recorded with the hash of the staged list'
);

-- While it awaits the decision, people can be taken off; the list itself never changes.
select lives_ok(
  $$update public.cowork_batch_proposals set excluded = '["f6000000-0000-4000-8000-000000000002"]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  'someone can be taken off the card before approving'
);
select throws_ok(
  $$update public.cowork_batch_proposals set items = '[{"id":"f6000000-0000-4000-8000-000000000009","name":"Otra","steps":["save"],"done":[]}]'::jsonb
    where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'the staged list cannot change after it was proposed'
);

-- What the table guard already refused is still refused for this kind.
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'lead_prepare_batch', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Héctor","steps":["save"],"done":[],"message":"Hola"}]'::jsonb, repeat('b', 64))$$,
  '23514', null, 'nobody in a batch to prepare contacts carries a message'
);
select throws_ok(
  $$insert into public.cowork_batch_proposals (run_id, user_id, organization_id, kind, items, patch_hash)
    values ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'prepare_anything', '[{"id":"f6000000-0000-4000-8000-000000000004","name":"Héctor"}]'::jsonb, repeat('c', 64))$$,
  '23514', null, 'an unknown kind of batch is still refused'
);

-- What was accepted before is still accepted.
select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002',
  'enrich_phone', 'f2000000-0000-4000-8000-000000000002', 'enrichphone:' || repeat('d', 64), 'Revelar el teléfono de Marcela Rojas'),
  true, 'the effects accepted before are still accepted');
select is((select count(*)::integer from pg_constraint where conrelid = 'public.cowork_effect_proposals'::regclass
  and conname = 'cowork_effect_proposals_kind_check' and pg_get_constraintdef(oid) like '%lead_prepare_batch%'
  and pg_get_constraintdef(oid) like '%enrich_phone%' and pg_get_constraintdef(oid) like '%reply_thread%'), 1,
  'the check of the proposals table names the new kind and keeps the earlier ones');

select * from finish();
rollback;
