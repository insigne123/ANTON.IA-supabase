begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(29);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values
  ('e0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('e0000000-0000-4000-8000-000000000002', 'pgtap-cowork-edit-outsider@antonia.test', now());

insert into public.organizations (id, name)
values
  ('e1000000-0000-4000-8000-000000000001', 'pgTAP Cowork edit'),
  ('e1000000-0000-4000-8000-000000000002', 'pgTAP Cowork edit outsider');

insert into public.organization_members (organization_id, user_id, role)
values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'owner'),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('e0000000-0000-4000-8000-000000000001', true);

-- A campaign definition as the worker stages it: two emails for two recipients.
create function pg_temp.def(p_subject text default 'AXIS en minutos', p_body text default E'Hola,\nte escribo por AXIS.')
returns jsonb language sql as $$
  select jsonb_build_object('name', 'RR. HH. septiembre', 'objective', 'Reuniones', 'criteria', jsonb_build_object('kind', 'saved'),
    'emails', jsonb_build_array('marcela@sodexo.cl', 'felipe@securitas.cl'), 'provider', 'gmail', 'overrides', '[]'::jsonb,
    'messages', jsonb_build_array(
      jsonb_build_object('subject', p_subject, 'body', p_body, 'delayDays', 0),
      jsonb_build_object('subject', 'Seguimiento', 'body', E'Hola,\n¿lo pudiste ver?', 'delayDays', 3)));
$$;
create function pg_temp.edit(p_run uuid, p_expected jsonb, p_next jsonb, p_changed integer[] default '{1}',
  p_user uuid default 'e0000000-0000-4000-8000-000000000001', p_org uuid default 'e1000000-0000-4000-8000-000000000001')
returns text language sql as $$ select public.cowork_edit_campaign_definition(p_run, p_user, p_org, p_expected, p_next, p_changed) $$;
-- The same definition with a first email written for some of its recipients (overrides).
create function pg_temp.own(p_overrides jsonb)
returns jsonb language sql as $$ select jsonb_set(pg_temp.def(), '{overrides}', p_overrides) $$;
create function pg_temp.marcela(p_extra jsonb default '[]'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('email', 'marcela@sodexo.cl', 'messageIndex', 0,
    'subject', 'Marcela, AXIS para Sodexo', 'body', E'Hola Marcela,\nvi que Sodexo contrata en regiones.') || p_extra);
$$;

-- Five turns waiting for approval: four campaigns and a contact to save.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status)
select ('e2000000-0000-4000-8000-00000000000' || n)::uuid, 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
  ('e3000000-0000-4000-8000-00000000000' || n)::uuid, 'Crea la campaña ' || n, 'approval', 'waiting_approval'
from generate_series(1, 5) n;

insert into public.cowork_effect_proposals (run_id, user_id, organization_id, kind, origin_run_id, target_id, label)
select ('e2000000-0000-4000-8000-00000000000' || n)::uuid, 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
  case when n = 3 then 'save_contact' else 'campaign_create' end, ('e2000000-0000-4000-8000-00000000000' || n)::uuid,
  case when n = 3 then 'e5000000-0000-4000-8000-000000000001' else 'new-campaign' end,
  case when n = 3 then 'Guardar contacto' else 'Crear campaña pausada' end
from generate_series(1, 5) n;

insert into public.cowork_campaign_definitions (run_id, user_id, organization_id, definition)
select ('e2000000-0000-4000-8000-00000000000' || n)::uuid, 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', pg_temp.def()
from unnest(array[1, 2, 4, 5]) n;

-- The edit of the version the person saw.
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def(), pg_temp.def('AXIS: antecedentes en minutos')), 'edited',
  'edits the version the person saw');
select is((select definition from public.cowork_campaign_definitions where run_id = 'e2000000-0000-4000-8000-000000000001'),
  pg_temp.def('AXIS: antecedentes en minutos'), 'the definition is the edit');
select results_eq(
  $$select payload from public.cowork_run_events where run_id = 'e2000000-0000-4000-8000-000000000001' and kind = 'proposal.edited'$$,
  $$values ('{"kind": "campaign_create", "emails": [1]}'::jsonb)$$,
  'one proposal.edited event with the emails, without the text'
);
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def(), pg_temp.def('Otra')), 'stale',
  'an old version is stale and changes nothing');

-- Only subjects and bodies change.
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'),
  jsonb_set(pg_temp.def('AXIS: antecedentes en minutos'), '{emails}', '["otra@x.cl", "felipe@securitas.cl"]'))$$,
  '22023', null, 'recipients cannot change');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'),
  jsonb_set(pg_temp.def('AXIS: antecedentes en minutos'), '{messages}', (pg_temp.def('AXIS: antecedentes en minutos') -> 'messages') - 1))$$,
  '22023', null, 'the number of emails cannot change');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'),
  jsonb_set(pg_temp.def('AXIS: antecedentes en minutos'), '{messages,1,delayDays}', '1'), '{2}')$$,
  '22023', null, 'the spacing cannot change');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'),
  jsonb_set(pg_temp.def('AXIS: antecedentes en minutos'), '{name}', '"Otro nombre"'))$$,
  '22023', null, 'the rest of the definition cannot change');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('   '))$$,
  '22023', null, 'an empty subject is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('Asunto', ''))$$,
  '22023', null, 'an empty body is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('Asunto'), '{3}')$$,
  '22023', null, 'a changed email that does not exist is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('Asunto'), '{}')$$,
  '22023', null, 'an edit that marks nothing as changed is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('a', repeat('x', 1048577)))$$,
  '22023', null, 'a definition over 1 MB is refused');
select is((select definition -> 'messages' -> 0 ->> 'subject' from public.cowork_campaign_definitions where run_id = 'e2000000-0000-4000-8000-000000000001'),
  'AXIS: antecedentes en minutos', 'the refused edits left the stored version');

-- The first email of one person (overrides): editable like the template, only for the campaign's recipients.
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000005', pg_temp.def(), pg_temp.own(pg_temp.marcela())), 'edited',
  'the email written for one person can be edited');
select is((select definition from public.cowork_campaign_definitions where run_id = 'e2000000-0000-4000-8000-000000000005'),
  pg_temp.own(pg_temp.marcela()), 'the definition keeps that email and the template as it was');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000005', pg_temp.own(pg_temp.marcela()),
  pg_temp.own(jsonb_set(pg_temp.marcela(), '{0,email}', '"otra@x.cl"')))$$,
  '22023', null, 'an email for someone outside the campaign is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000005', pg_temp.own(pg_temp.marcela()),
  pg_temp.own(jsonb_set(pg_temp.marcela(), '{0,messageIndex}', '2')))$$,
  '22023', null, 'an email beyond the sequence is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000005', pg_temp.own(pg_temp.marcela()),
  pg_temp.own(pg_temp.marcela(pg_temp.marcela())))$$,
  '22023', null, 'two versions of the same email for one person are refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000005', pg_temp.own(pg_temp.marcela()),
  pg_temp.own(jsonb_set(pg_temp.marcela(), '{0,body}', '"  "')))$$,
  '22023', null, 'an empty email for one person is refused');
select throws_ok($$select pg_temp.edit('e2000000-0000-4000-8000-000000000005', pg_temp.own(pg_temp.marcela()),
  jsonb_set(pg_temp.own(jsonb_set(pg_temp.marcela(), '{0,subject}', '"Otro"')), '{emails}', '["marcela@sodexo.cl"]'))$$,
  '22023', null, 'editing one person''s email still cannot change the recipients');

-- Only the owner, in the turn's organization, over a campaign proposal still pending.
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('x'), '{1}',
  'e0000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002'), 'forbidden', 'another person is refused');
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000001', pg_temp.def('AXIS: antecedentes en minutos'), pg_temp.def('x'), '{1}',
  'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002'), 'forbidden', 'an organization the owner is not in is refused');
select is(pg_temp.edit('e2000000-0000-4000-8000-0000000000ff', pg_temp.def(), pg_temp.def('x')), 'not_found', 'a turn that does not exist is not found');
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000003', pg_temp.def(), pg_temp.def('x')), 'not_pending', 'a proposal of another kind is not editable');

-- Approval and edit take the same locks: once approved or discarded, the edit is refused and the version stays.
select is(public.cowork_resolve_effect('e2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', true),
  true, 'the approval goes first');
select is(pg_temp.edit('e2000000-0000-4000-8000-000000000002', pg_temp.def(), pg_temp.def('Tarde')) || ':'
  || (select definition -> 'messages' -> 0 ->> 'subject' from public.cowork_campaign_definitions where run_id = 'e2000000-0000-4000-8000-000000000002'),
  'not_pending:AXIS en minutos', 'after approving, the approved version stays');
select is((select public.cowork_resolve_effect('e2000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', false)::text)
  || ':' || pg_temp.edit('e2000000-0000-4000-8000-000000000004', pg_temp.def(), pg_temp.def('Tarde')),
  'true:not_pending', 'after discarding, nothing is edited');

select ok(not has_function_privilege('authenticated', 'public.cowork_edit_campaign_definition(uuid, uuid, uuid, jsonb, jsonb, integer[])', 'execute')
  and not has_function_privilege('anon', 'public.cowork_edit_campaign_definition(uuid, uuid, uuid, jsonb, jsonb, integer[])', 'execute')
  and has_function_privilege('service_role', 'public.cowork_edit_campaign_definition(uuid, uuid, uuid, jsonb, jsonb, integer[])', 'execute'),
  'only the service role runs it');

select * from finish();
rollback;
