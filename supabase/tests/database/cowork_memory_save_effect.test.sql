begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

-- The verified owner (the only Cowork account today).
insert into auth.users (id, email, email_confirmed_at)
values ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now());

insert into public.organizations (id, name)
values ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork memory');

insert into public.organization_members (organization_id, user_id, role)
values ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('f0000000-0000-4000-8000-000000000001', true);

-- A turn under a live lease proposes remembering a preference; another proposes something unknown.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000001', 'Recuerda que no le escribo a la competencia', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-000000000002', 'Recuerda cualquier cosa', 'approval', 'running',
   'f4000000-0000-4000-8000-000000000002', now() + interval '2 minutes');

select is(public.cowork_propose_effect('f2000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  'memory_save', 'f2000000-0000-4000-8000-000000000001', 'memory:f5000000-0000-4000-8000-000000000001', 'Recordar: «No le escribo a la competencia»'),
  true, 'the lease holder proposes remembering a preference');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'f2000000-0000-4000-8000-000000000001'$$,
  $$values ('memory_save'::text, 'proposed'::text, 'memory:f5000000-0000-4000-8000-000000000001'::text)$$,
  'the proposal points at the staged memory'
);
select is((select status from public.cowork_runs where id = 'f2000000-0000-4000-8000-000000000001'), 'waiting_approval',
  'the turn waits for approval');

-- What was accepted before is still accepted, and anything else is still refused.
select ok(pg_get_functiondef('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)'::regprocedure) like '%''lead_prepare_batch''%'
  and pg_get_functiondef('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)'::regprocedure) like '%''reply_thread''%',
  'the earlier effects are still in the list of the function');
select throws_ok(
  $$select public.cowork_propose_effect('f2000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000002',
    'memory_forget', 'f2000000-0000-4000-8000-000000000002', 'memory:x', 'Olvidar')$$,
  '22023', 'Unknown effect', 'an unknown effect is still refused'
);
select is((select count(*)::integer from pg_constraint where conrelid = 'public.cowork_effect_proposals'::regclass
  and conname = 'cowork_effect_proposals_kind_check' and pg_get_constraintdef(oid) like '%memory_save%' and pg_get_constraintdef(oid) like '%lead_prepare_batch%'), 1,
  'the check of the table names the new kind and keeps the earlier ones');

select * from finish();
rollback;
