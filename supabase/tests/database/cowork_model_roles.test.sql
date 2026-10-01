begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(24);

-- The verified owner (the only Cowork account today).
insert into auth.users (id, email, email_confirmed_at)
values ('c0000000-0000-4000-8000-000000000011', 'nicolas.yarur.g@yago.cl', now());

insert into public.organizations (id, name)
values ('c1000000-0000-4000-8000-000000000011', 'pgTAP Cowork roles');

insert into public.organization_members (organization_id, user_id, role)
values ('c1000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000011', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('c0000000-0000-4000-8000-000000000011', true);

-- Turns 1 to 3 run under a live lease. Turn 4 finished and turn 5 follows it in the same
-- conversation. Turn 6 finished (not running).
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at, parent_run_id)
values
  ('c2000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011',
   'c3000000-0000-4000-8000-000000000011', 'Escribe una secuencia para RR. HH.', 'approval', 'running',
   'c4000000-0000-4000-8000-000000000011', now() + interval '2 minutes', null),
  ('c2000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011',
   'c3000000-0000-4000-8000-000000000012', '¿Cómo voy?', 'approval', 'running',
   'c4000000-0000-4000-8000-000000000012', now() + interval '2 minutes', null),
  ('c2000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011',
   'c3000000-0000-4000-8000-000000000013', 'Revisa mis campañas', 'approval', 'running',
   'c4000000-0000-4000-8000-000000000013', now() + interval '2 minutes', null),
  ('c2000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011',
   'c3000000-0000-4000-8000-000000000014', 'Busca contactos de RR. HH.', 'approval', 'completed',
   null, null, null),
  ('c2000000-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011',
   'c3000000-0000-4000-8000-000000000016', '¿A quién le escribo hoy?', 'approval', 'completed',
   'c4000000-0000-4000-8000-000000000016', now() + interval '2 minutes', null);
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at, parent_run_id, depth)
values ('c2000000-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011',
  'c3000000-0000-4000-8000-000000000015', 'Ahora escríbeles', 'approval', 'running',
  'c4000000-0000-4000-8000-000000000015', now() + interval '2 minutes', 'c2000000-0000-4000-8000-000000000014', 1);

-- The ledger takes the new roles and still refuses anything else.
select throws_ok(
  $$insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
    values ('c2000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011', 'boss', 1)$$,
  '23514', null, 'an unknown role is refused by the ledger'
);

-- In-turn roles reserve under the run's lease, each with its own cap per turn.
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'writer'), null,
  'the writer reserves a call');
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'writer'), null,
  'the writer reserves a second call, for its correction');
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'writer')$$,
  'P0001', 'Model budget exhausted', 'a third writer call is refused'
);
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'reviewer'), null,
  'the reviewer reserves a call');
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'reviewer')$$,
  'P0001', 'Model budget exhausted', 'a second reviewer call is refused'
);
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'judge'), null,
  'the judge reserves a call');
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'judge')$$,
  'P0001', 'Model budget exhausted', 'a second judge call is refused'
);
select results_eq(
  $$select role, output_reserved from public.cowork_model_calls where run_id = 'c2000000-0000-4000-8000-000000000011' order by role, created_at$$,
  $$values ('judge'::text, 1500), ('reviewer'::text, 1500), ('writer'::text, 6000), ('writer'::text, 6000)$$,
  'the writer reserves 6 000 tokens, the reviewer and the judge 1 500'
);
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000011', 'coordinator'), null,
  'the coordinator still reserves beside them');

-- Only the lease holder of a running turn.
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000012', 'c4000000-0000-4000-8000-00000000001f', 'writer')$$,
  'P0001', 'Model attempt expired', 'a wrong lease token is refused'
);
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000016', 'c4000000-0000-4000-8000-000000000016', 'writer')$$,
  'P0001', 'Model attempt expired', 'a turn that is not running is refused'
);
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000012', 'c4000000-0000-4000-8000-000000000012', 'boss')$$,
  'P0001', 'Specialist attempt unavailable', 'an unknown role is refused'
);

-- 11 calls per turn: after 10, one more fits and the next does not.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'c2000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011', 'coordinator', 100
from generate_series(1, 10);
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000012', 'c4000000-0000-4000-8000-000000000012', 'judge'), null,
  'the eleventh call of a turn fits');
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000012', 'c4000000-0000-4000-8000-000000000012', 'reviewer')$$,
  'P0001', 'Model budget exhausted', 'the twelfth call of a turn is refused'
);

-- 55 000 reserved tokens per turn.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
values ('c2000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011', 'coordinator', 50000);
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000013', 'c4000000-0000-4000-8000-000000000013', 'writer')$$,
  'P0001', 'Model budget exhausted', 'a writer call over 55 000 tokens in the turn is refused'
);
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000013', 'c4000000-0000-4000-8000-000000000013', 'reviewer'), null,
  'a reviewer call that still fits is admitted');

-- 200 calls per conversation, across its turns: a guard against a loop since 20261001220000 (it was 40, and a long
-- conversation reached it). The conversation is read through root_run_id, with its own reason.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'c2000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011', 'coordinator', 100
from generate_series(1, 199);
select isnt(public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000015', 'c4000000-0000-4000-8000-000000000015', 'writer'), null,
  'the two hundredth call of a conversation fits');
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000015', 'c4000000-0000-4000-8000-000000000015', 'reviewer')$$,
  'P0001', 'Conversation model budget exhausted', 'the two hundred and first call of a conversation is refused'
);

-- 1 000 000 reserved tokens per conversation (it was 180 000).
delete from public.cowork_model_calls where run_id in ('c2000000-0000-4000-8000-000000000014', 'c2000000-0000-4000-8000-000000000015');
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
values ('c2000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000011', 'coordinator', 995000);
select throws_ok(
  $$select public.cowork_reserve_model_call('c2000000-0000-4000-8000-000000000015', 'c4000000-0000-4000-8000-000000000015', 'writer')$$,
  'P0001', 'Conversation model budget exhausted', 'a writer call over 1 000 000 tokens in the conversation is refused'
);

-- The usage of an in-turn call is recorded under the run's lease, once.
select is(public.cowork_record_model_usage(
    (select id from public.cowork_model_calls where run_id = 'c2000000-0000-4000-8000-000000000011' and role = 'writer' order by created_at limit 1),
    'c4000000-0000-4000-8000-00000000001f', '{"output_tokens": 812}'),
  false, 'a wrong token records no usage');
select is(public.cowork_record_model_usage(
    (select id from public.cowork_model_calls where run_id = 'c2000000-0000-4000-8000-000000000011' and role = 'writer' order by created_at limit 1),
    'c4000000-0000-4000-8000-000000000011', '{"output_tokens": 812}'),
  true, 'the lease holder records the writer usage');
select is((select usage from public.cowork_model_calls where run_id = 'c2000000-0000-4000-8000-000000000011' and role = 'writer' order by created_at limit 1),
  '{"output_tokens": 812}'::jsonb, 'the usage is stored');

select ok(not has_function_privilege('authenticated', 'public.cowork_reserve_model_call(uuid, uuid, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cowork_reserve_model_call(uuid, uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.cowork_record_model_usage(uuid, uuid, jsonb)', 'execute'),
  'only the service role reserves calls and records usage');

select * from finish();
rollback;
