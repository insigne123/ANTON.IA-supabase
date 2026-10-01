begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(11);

-- The verified owner (the only Cowork account today).
insert into auth.users (id, email, email_confirmed_at)
values ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now());
insert into public.organizations (id, name) values ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork conversaciones largas');
insert into public.organization_members (organization_id, user_id, role)
values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner');
insert into public.cowork_access_grants (user_id, enabled) values ('f0000000-0000-4000-8000-000000000001', true);

select has_column('public', 'cowork_runs', 'root_run_id', 'every run knows the first run of its conversation');
select col_not_null('public', 'cowork_runs', 'root_run_id', 'and it is always set');

-- The conversation of the test of 1 Oct, made longer: a first message and sixteen turns after it.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status)
values ('f2000000-0000-4000-8000-000000000000', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000000', 'Quiero vender revisión de antecedentes a empresas de servicios', 'approval', 'completed');
do $$
declare parent uuid := 'f2000000-0000-4000-8000-000000000000';
begin
  for n in 1..16 loop
    insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, parent_run_id)
    values (('f2000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'f0000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000001', ('f3000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid,
      'Turno ' || n, 'approval', 'completed', parent);
    parent := ('f2000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid;
  end loop;
end $$;

select is((select root_run_id from public.cowork_runs where id = 'f2000000-0000-4000-8000-000000000000'),
  'f2000000-0000-4000-8000-000000000000'::uuid, 'the first run is its own conversation');
select is((select count(*)::integer from public.cowork_runs where root_run_id = 'f2000000-0000-4000-8000-000000000000'), 17,
  'the sixteen turns after it belong to the same conversation');

-- A reply the person writes after them, admitted as the app does it.
select lives_ok($$
  select public.cowork_admit_followup('f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-0000000000ff', 'Ahora escríbeles', 'approval', 'f2000000-0000-4000-8000-000000000010', true)
$$, 'a reply after sixteen turns is admitted');
select is((select root_run_id from public.cowork_runs where request_id = 'f3000000-0000-4000-8000-0000000000ff'),
  'f2000000-0000-4000-8000-000000000000'::uuid, 'and joins the same conversation when it is attached to its parent');

-- It runs under a live lease and reserves its model calls: the old walk refused past 13 ancestors.
update public.cowork_runs set status = 'running', lease_token = 'f4000000-0000-4000-8000-000000000001', lease_expires_at = now() + interval '2 minutes'
  where request_id = 'f3000000-0000-4000-8000-0000000000ff';
select isnt((select public.cowork_reserve_model_call((select id from public.cowork_runs where request_id = 'f3000000-0000-4000-8000-0000000000ff'),
  'f4000000-0000-4000-8000-000000000001', 'coordinator', null)), null, 'the 18th turn of a conversation reserves its model call');

-- The guard of a whole conversation: 200 calls.
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'coordinator', 100
from generate_series(1, 200);
select throws_ok($$
  select public.cowork_reserve_model_call((select id from public.cowork_runs where request_id = 'f3000000-0000-4000-8000-0000000000ff'),
    'f4000000-0000-4000-8000-000000000001', 'coordinator', null)
$$, 'P0001', 'Conversation model budget exhausted', 'a conversation stops at its guard, with its own reason');
delete from public.cowork_model_calls where run_id = 'f2000000-0000-4000-8000-000000000001';

-- The cap of the day per person counts every conversation of that person.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values ('f2000000-0000-4000-8000-000000000100', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000100', 'Otra conversación', 'approval', 'running', 'f4000000-0000-4000-8000-000000000002', now() + interval '2 minutes');
select isnt((select public.cowork_reserve_model_call('f2000000-0000-4000-8000-000000000100', 'f4000000-0000-4000-8000-000000000002', 'coordinator', null)),
  null, 'another conversation reserves as usual');
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'coordinator', 100
from generate_series(1, 300);
select throws_ok($$
  select public.cowork_reserve_model_call('f2000000-0000-4000-8000-000000000100', 'f4000000-0000-4000-8000-000000000002', 'coordinator', null)
$$, 'P0001', 'Daily model budget exhausted', 'the day of a person stops all their conversations, with its own reason');

-- The cap of a single turn is unchanged.
delete from public.cowork_model_calls where run_id = 'f2000000-0000-4000-8000-000000000001';
insert into public.cowork_model_calls (run_id, user_id, organization_id, role, output_reserved)
select 'f2000000-0000-4000-8000-000000000100', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'writer', 100
from generate_series(1, 10);
select throws_ok($$
  select public.cowork_reserve_model_call('f2000000-0000-4000-8000-000000000100', 'f4000000-0000-4000-8000-000000000002', 'coordinator', null)
$$, 'P0001', 'Model budget exhausted', 'a single turn keeps its eleven calls');

select * from finish();
rollback;
