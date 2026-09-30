begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(11);

-- The verified owner (the only Cowork account today).
insert into auth.users (id, email, email_confirmed_at)
values ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now());

insert into public.organizations (id, name)
values ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork retry and phone');

insert into public.organization_members (organization_id, user_id, role)
values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('f0000000-0000-4000-8000-000000000001', true);

-- Four turns under a live lease: each proposes one effect.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000001', 'Reintenta los envíos que fallaron', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000002', 'Revela el teléfono de Marcela', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000002', now() + interval '2 minutes'),
  ('f2000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000003', 'Invita a Paula', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000003', now() + interval '2 minutes'),
  ('f2000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000004', 'Hazlo de cualquier forma', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000004', now() + interval '2 minutes');

select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  'campaign_retry', 'f2000000-0000-4000-8000-000000000001', 'campaignretry:' || repeat('a', 64), 'Reintentar 3 envíos de la campaña'),
  true, 'the lease holder proposes retrying the failed sends of a campaign');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  $$values ('campaign_retry'::text, 'proposed'::text, 'campaignretry:' || repeat('a', 64))$$,
  'the retry is recorded with the hash of what the card listed'
);
select is((select status from public.cowork_runs where id = 'f2000000-0000-4000-8000-000000000001'), 'waiting_approval',
  'the turn waits for approval');

select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002',
  'enrich_phone', 'f2000000-0000-4000-8000-000000000002', 'enrichphone:' || repeat('b', 64), 'Revelar el teléfono de Marcela Rojas'),
  true, 'the lease holder proposes revealing a phone');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'f2000000-0000-4000-8000-000000000002'$$,
  $$values ('enrich_phone'::text, 'proposed'::text, 'enrichphone:' || repeat('b', 64))$$,
  'the phone reveal is recorded with the hash of what the card listed'
);

-- What was accepted before is still accepted.
select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000003',
  'linkedin_message_batch', 'f2000000-0000-4000-8000-000000000003', 'linkedinbatch:' || repeat('c', 64), 'Escribir a 3 personas por LinkedIn'),
  true, 'the LinkedIn batches are still accepted');
select ok(pg_get_functiondef('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)'::regprocedure) like '%''reply_thread''%'
  and pg_get_functiondef('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)'::regprocedure) like '%''contacts_import''%',
  'the earlier effects are still in the list of the function');

-- Anything else is still refused, by the function and by the table.
select throws_ok(
  $$select public.cowork_propose_effect('f2000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000004',
    'retry_anything', 'f2000000-0000-4000-8000-000000000004', 'retry:x', 'Reintentar')$$,
  '22023', 'Unknown effect', 'an unknown effect is still refused'
);
select throws_ok(
  $$insert into public.cowork_effect_proposals (run_id, user_id, organization_id, kind, origin_run_id, target_id, label)
    values ('f2000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
      'retry_anything', 'f2000000-0000-4000-8000-000000000004', 'x', 'Reintentar')$$,
  '23514', null, 'the table refuses an unknown effect too'
);
select is((select count(*)::integer from pg_constraint where conrelid = 'public.cowork_effect_proposals'::regclass
  and conname = 'cowork_effect_proposals_kind_check' and pg_get_constraintdef(oid) like '%campaign_retry%' and pg_get_constraintdef(oid) like '%enrich_phone%'), 1,
  'the check of the table names the two new kinds');

select * from finish();
