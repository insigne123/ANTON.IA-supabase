begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(20);

-- The verified owner (the only Cowork account today).
insert into auth.users (id, email, email_confirmed_at)
values ('b0000000-0000-4000-8000-000000000021', 'nicolas.yarur.g@yago.cl', now());

insert into public.organizations (id, name)
values ('b1000000-0000-4000-8000-000000000021', 'pgTAP Cowork delegados');

insert into public.organization_members (organization_id, user_id, role)
values ('b1000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('b0000000-0000-4000-8000-000000000021', true);

-- Turns 1 to 4 run under a live lease. Turn 5 finished and turn 6 follows it in the same conversation. Turn 7 finished (not running).
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at, parent_run_id)
values
  ('b2000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
   'b3000000-0000-4000-8000-000000000021', 'Investiga a Enaex, Besalco y Gasco', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000021', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
   'b3000000-0000-4000-8000-000000000022', 'Compara estas cuatro empresas', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000022', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
   'b3000000-0000-4000-8000-000000000023', 'Investiga estas empresas', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000023', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000024', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
   'b3000000-0000-4000-8000-000000000024', 'Y estas otras', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000024', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000025', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
   'b3000000-0000-4000-8000-000000000025', 'Busca contactos de RR. HH.', 'approval', 'completed',
   null, null, null),
  ('b2000000-0000-4000-8000-000000000027', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
   'b3000000-0000-4000-8000-000000000027', '¿A quién le escribo hoy?', 'approval', 'completed',
   'b4000000-0000-4000-8000-000000000027', now() + interval '2 minutes', null);
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at, parent_run_id, depth)
values ('b2000000-0000-4000-8000-000000000026', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021',
  'b3000000-0000-4000-8000-000000000026', 'Ahora compáralas', 'approval', 'running',
  'b4000000-0000-4000-8000-000000000026', now() + interval '2 minutes', 'b2000000-0000-4000-8000-000000000025', 1);

-- The ledger takes the new role and still refuses anything else.
select lives_ok(
  $$insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
    values ('b2000000-0000-4000-8000-000000000025', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021', 'delegate', 1)$$,
  'the ledger takes the delegate role'
);
select throws_ok(
  $$insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
    values ('b2000000-0000-4000-8000-000000000025', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021', 'boss', 1)$$,
  '23514', null, 'an unknown role is still refused'
);
delete from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000025';

-- A delegate reserves under the run's lease and is reserved 2 500 tokens.
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000021', 'delegate'), null,
  'a delegate reserves a call');
select results_eq(
  $$select role, output_reserved from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000021'$$,
  $$values ('delegate'::text, 2500)$$,
  'it is reserved 2 500 tokens'
);

-- Twelve calls among all the delegates of a turn; the thirteenth is refused.
select lives_ok($$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000021', 'delegate') from generate_series(1, 11)$$,
  'the twelfth delegate call of the turn fits');
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000021', 'delegate')$$,
  'P0001', 'Model budget exhausted', 'a thirteenth delegate call is refused'
);

-- The delegates do not use up the room of the others: the coordinator and the writer still reserve their calls beside twelve delegate calls.
select lives_ok($$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000021', 'coordinator') from generate_series(1, 5)$$,
  'the coordinator still reserves its five calls');
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000021', 'coordinator')$$,
  'P0001', 'Model budget exhausted', 'a sixth coordinator call is refused, as always'
);
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000021', 'b4000000-0000-4000-8000-000000000021', 'writer'), null,
  'the writer still reserves beside them');
select is((select count(*)::integer from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000021'), 18,
  'twelve delegate calls, five of the coordinator and one of the writer: more than the eleven of the others, by design');

-- And the others do not use up the delegates': ten calls of the coordinator's kind in the turn, and a delegate still fits.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'b2000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021', 'coordinator', 100
from generate_series(1, 11);
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000022', 'b4000000-0000-4000-8000-000000000022', 'delegate'), null,
  'a delegate fits in a turn whose eleven calls of the others are spent');
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000022', 'b4000000-0000-4000-8000-000000000022', 'judge')$$,
  'P0001', 'Model budget exhausted', 'while the others still have their eleven'
);

-- 40 000 reserved tokens among the delegates of a turn.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
values ('b2000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021', 'delegate', 38000);
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000023', 'b4000000-0000-4000-8000-000000000023', 'delegate')$$,
  'P0001', 'Model budget exhausted', 'a delegate call over 40 000 tokens in the turn is refused'
);
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000023', 'b4000000-0000-4000-8000-000000000023', 'reviewer'), null,
  'the tokens of the delegates are not the others\'');

-- Only the lease holder of a running turn.
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000024', 'b4000000-0000-4000-8000-00000000002f', 'delegate')$$,
  'P0001', 'Model attempt expired', 'a wrong lease token is refused'
);
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000027', 'b4000000-0000-4000-8000-000000000027', 'delegate')$$,
  'P0001', 'Model attempt expired', 'a turn that is not running is refused'
);

-- The conversation and the day count the delegates like any call: 200 calls per conversation.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'b2000000-0000-4000-8000-000000000025', 'b0000000-0000-4000-8000-000000000021', 'b1000000-0000-4000-8000-000000000021', 'coordinator', 100
from generate_series(1, 199);
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000026', 'b4000000-0000-4000-8000-000000000026', 'delegate'), null,
  'the two hundredth call of a conversation fits, a delegate\'s too');
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000026', 'b4000000-0000-4000-8000-000000000026', 'delegate')$$,
  'P0001', 'Conversation model budget exhausted', 'the two hundred and first is refused with the conversation\'s reason'
);

-- The usage of a delegate call is recorded under the lease of the run, like the coordinator's, once.
select is(public.cowork_record_model_usage(
    (select id from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000021' and role = 'delegate' order by created_at, id limit 1),
    'b4000000-0000-4000-8000-00000000002f', '{"output_tokens": 640}'),
  false, 'a wrong token records no usage');
select is(public.cowork_record_model_usage(
    (select id from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000021' and role = 'delegate' order by created_at, id limit 1),
    'b4000000-0000-4000-8000-000000000021', '{"output_tokens": 640}'),
  true, 'the lease holder records the delegate usage');

select * from finish();
rollback;
