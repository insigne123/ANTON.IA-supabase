begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(20);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values
  ('e0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('e0000000-0000-4000-8000-000000000002', 'pgtap-cowork-reply-outsider@antonia.test', now());

insert into public.organizations (id, name)
values
  ('e1000000-0000-4000-8000-000000000001', 'pgTAP Cowork reply'),
  ('e1000000-0000-4000-8000-000000000002', 'pgTAP Cowork reply outsider');

insert into public.organization_members (organization_id, user_id, role)
values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'owner'),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('e0000000-0000-4000-8000-000000000001', true);

insert into public.leads (id, user_id, organization_id, name, title, company, status)
values
  ('e5000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'Marcela Rojas', 'Gerente de RR. HH.', 'Servicios Norte', 'saved');

-- The conversation the reply goes into: a send of the owner's that the person answered.
insert into public.contacted_leads (id, user_id, organization_id, lead_id, status, email, created_at)
values
  ('pgtap-reply-contacted', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'e5000000-0000-4000-8000-000000000001', 'replied', 'mrojas@sernorte.test', now());

-- Turn 1 runs under a live lease and proposes the reply. Turn 2 finished: it holds a staged
-- reply to show that the row goes away with its run.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'e3000000-0000-4000-8000-000000000001', 'Prepárale la respuesta a Marcela', 'approval', 'running',
   'e4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'e3000000-0000-4000-8000-000000000002', 'Respóndele a Héctor', 'approval', 'completed',
   null, null);

select has_table('public', 'cowork_reply_proposals', 'the staging table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_reply_proposals'::regclass), 'the staging table has RLS on');
select ok(not has_table_privilege('authenticated', 'public.cowork_reply_proposals', 'select')
  and not has_table_privilege('anon', 'public.cowork_reply_proposals', 'select')
  and not has_table_privilege('authenticated', 'public.cowork_reply_proposals', 'insert'),
  'no signed-in or anonymous account reads or writes staged replies');
select ok(has_table_privilege('service_role', 'public.cowork_reply_proposals', 'insert')
  and has_table_privilege('service_role', 'public.cowork_reply_proposals', 'select'),
  'the worker stages and reads replies');

-- A staged reply: to whom, the subject, the body and the hash of what the card shows.
select lives_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: Antecedentes laborales en minutos',
      E'Hola Marcela,\n\nGracias por responder. ¿Cuántas personas necesitas revisar?\n\nSaludos,\nNicolás', repeat('a', 64))$$,
  'a reply with its recipient, subject, body and hash is staged'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: otro', 'Otro texto', repeat('b', 64))$$,
  '23505', null, 'one staged reply per run'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-no-such-conversation', 'mrojas@sernorte.test', 'Re: x', 'Hola', repeat('c', 64))$$,
  '23503', null, 'a reply needs an existing conversation'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', '   ', 'Hola', repeat('c', 64))$$,
  '23514', null, 'a reply needs a subject'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: x', '   ', repeat('c', 64))$$,
  '23514', null, 'a reply needs a body'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: x', repeat('x', 8001), repeat('c', 64))$$,
  '23514', null, 'a reply body holds 8000 characters at most'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'sin-arroba', 'Re: x', 'Hola', repeat('c', 64))$$,
  '23514', null, 'the recipient is an address'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: x', 'Hola', 'no-es-un-hash')$$,
  '23514', null, 'the hash is 64 hex characters'
);
select throws_ok(
  $$insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002',
      'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: x', 'Hola', repeat('c', 64))$$,
  '23503', null, 'a reply belongs to the owner and organization of its run'
);

-- The live turn proposes the reply; the run then waits for the person's decision.
select is(public.cowork_propose_effect('e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
  'reply_thread', 'e2000000-0000-4000-8000-000000000001', 'replythread:' || repeat('a', 64), 'Responder a Marcela Rojas en su hilo'),
  true, 'the lease holder proposes a reply in the thread');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'e2000000-0000-4000-8000-000000000001'$$,
  $$values ('reply_thread'::text, 'proposed'::text, 'replythread:' || repeat('a', 64))$$,
  'the proposal is recorded as a reply in the thread'
);
select is((select status from public.cowork_runs where id = 'e2000000-0000-4000-8000-000000000001'), 'waiting_approval',
  'the turn waits for approval');
select throws_ok(
  $$select public.cowork_propose_effect('e2000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
    'reply_anywhere', 'e2000000-0000-4000-8000-000000000001', 'reply:x', 'Responder')$$,
  '22023', 'Unknown effect', 'an unknown effect is still refused'
);
select throws_ok(
  $$insert into public.cowork_effect_proposals (run_id, user_id, organization_id, kind, origin_run_id, target_id, label)
    values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
      'reply_anywhere', 'e2000000-0000-4000-8000-000000000002', 'x', 'Responder')$$,
  '23514', null, 'the table refuses an unknown effect too'
);

-- The staged reply goes away with its run, and with its conversation.
insert into public.cowork_reply_proposals (run_id, user_id, organization_id, contacted_id, to_email, subject, body, patch_hash)
values ('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
  'pgtap-reply-contacted', 'mrojas@sernorte.test', 'Re: Antecedentes laborales en minutos', 'Hola Héctor', repeat('d', 64));
delete from public.cowork_run_events where run_id = 'e2000000-0000-4000-8000-000000000002';
delete from public.cowork_runs where id = 'e2000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.cowork_reply_proposals where run_id = 'e2000000-0000-4000-8000-000000000002'), 0,
  'deleting the run deletes its staged reply');
delete from public.contacted_leads where id = 'pgtap-reply-contacted';
select is((select count(*)::integer from public.cowork_reply_proposals), 0, 'deleting the conversation deletes its staged replies');

select * from finish();
rollback;
