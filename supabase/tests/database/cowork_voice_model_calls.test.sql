begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(15);

-- A fictional person with access to Cowork.
insert into auth.users (id, email, email_confirmed_at)
values ('b0000000-0000-4000-8000-000000000031', 'nicolas.yarur.g@yago.cl', now());

insert into public.organizations (id, name)
values ('b1000000-0000-4000-8000-000000000031', 'pgTAP Cowork voz');

insert into public.organization_members (organization_id, user_id, role)
values ('b1000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000031', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('b0000000-0000-4000-8000-000000000031', true);

-- Turns 1 to 3 run under a live lease. Turn 4 finished.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at, parent_run_id)
values
  ('b2000000-0000-4000-8000-000000000031', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031',
   'b3000000-0000-4000-8000-000000000031', 'Escríbele una secuencia a Rodrigo', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000031', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000032', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031',
   'b3000000-0000-4000-8000-000000000032', 'Escríbele a Paula', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000032', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000033', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031',
   'b3000000-0000-4000-8000-000000000033', 'Escríbele a Marta', 'approval', 'running',
   'b4000000-0000-4000-8000-000000000033', now() + interval '2 minutes', null),
  ('b2000000-0000-4000-8000-000000000034', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031',
   'b3000000-0000-4000-8000-000000000034', 'Escríbele a Jorge', 'approval', 'completed',
   'b4000000-0000-4000-8000-000000000034', now() + interval '2 minutes', null);

-- The ledger takes the new role and still refuses anything else.
select lives_ok(
  $$insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
    values ('b2000000-0000-4000-8000-000000000034', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031', 'voice', 1)$$,
  'the ledger takes the voice role'
);
select throws_ok(
  $$insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
    values ('b2000000-0000-4000-8000-000000000034', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031', 'editor', 1)$$,
  '23514', null, 'an unknown role is still refused'
);
delete from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000034';

-- A voice call reserves under the run's lease and is reserved 1 500 tokens.
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000031', 'b4000000-0000-4000-8000-000000000031', 'voice'), null,
  'the voice pass reserves a call');
select results_eq(
  $$select role, output_reserved from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000031'$$,
  $$values ('voice'::text, 1500)$$,
  'it is reserved 1 500 tokens'
);

-- Eight calls in a turn (four emails, two tries each); the ninth is refused.
select lives_ok($$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000031', 'b4000000-0000-4000-8000-000000000031', 'voice') from generate_series(1, 7)$$,
  'the eighth voice call of the turn fits');
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000031', 'b4000000-0000-4000-8000-000000000031', 'voice')$$,
  'P0001', 'Model budget exhausted', 'a ninth voice call is refused'
);

-- The voice pass does not use up the Writer's room: its two calls and the Reviewer's still fit beside eight voice calls, and a third is refused as always.
select lives_ok($$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000031', 'b4000000-0000-4000-8000-000000000031', 'writer') from generate_series(1, 2)$$,
  'the Writer still reserves its two calls');
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000031', 'b4000000-0000-4000-8000-000000000031', 'writer')$$,
  'P0001', 'Model budget exhausted', 'a third Writer call is refused, as always'
);
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000031', 'b4000000-0000-4000-8000-000000000031', 'reviewer'), null,
  'the Reviewer still reserves beside them');

-- And the others do not use up the voice pass's: a turn whose eleven calls are spent still takes a voice call.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'b2000000-0000-4000-8000-000000000032', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031', 'coordinator', 100
from generate_series(1, 11);
select isnt(public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000032', 'b4000000-0000-4000-8000-000000000032', 'voice'), null,
  'a voice call fits in a turn whose eleven calls of the others are spent');

-- 12 000 reserved tokens among the voice calls of a turn.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
values ('b2000000-0000-4000-8000-000000000033', 'b0000000-0000-4000-8000-000000000031', 'b1000000-0000-4000-8000-000000000031', 'voice', 11000);
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000033', 'b4000000-0000-4000-8000-000000000033', 'voice')$$,
  'P0001', 'Model budget exhausted', 'a voice call over 12 000 tokens in the turn is refused'
);

-- Only the lease holder of a running turn.
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000032', 'b4000000-0000-4000-8000-00000000003f', 'voice')$$,
  'P0001', 'Model attempt expired', 'a wrong lease token is refused'
);
select throws_ok(
  $$select public.cowork_reserve_model_call('b2000000-0000-4000-8000-000000000034', 'b4000000-0000-4000-8000-000000000034', 'voice')$$,
  'P0001', 'Model attempt expired', 'a turn that is not running is refused'
);

-- The usage of a voice call is recorded under the lease of the run, like the Writer's.
select is(public.cowork_record_model_usage(
    (select id from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000031' and role = 'voice' order by created_at, id limit 1),
    'b4000000-0000-4000-8000-00000000003f', '{"output_tokens": 180}'),
  false, 'a wrong token records no usage');
select is(public.cowork_record_model_usage(
    (select id from public.cowork_model_calls where run_id = 'b2000000-0000-4000-8000-000000000031' and role = 'voice' order by created_at, id limit 1),
    'b4000000-0000-4000-8000-000000000031', '{"output_tokens": 180}'),
  true, 'the lease holder records the voice usage');

select * from finish();
rollback;
