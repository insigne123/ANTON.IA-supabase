begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(23);

insert into auth.users (id, email)
values
  ('ca000000-0000-4000-8000-000000000001', 'pipeline-member@antonia.test'),
  ('ca000000-0000-4000-8000-000000000002', 'pipeline-outsider@antonia.test');

insert into public.organizations (id, name)
values
  ('ca100000-0000-4000-8000-000000000001', 'Pipeline Team'),
  ('ca100000-0000-4000-8000-000000000002', 'Pipeline Other');

insert into public.organization_members (organization_id, user_id, role)
values
  ('ca100000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'member'),
  ('ca100000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'owner');

insert into public.leads (id, user_id, organization_id, name, title, company, email, status)
values
  ('ca200000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001',
   'Marcela Rojas', 'Gerenta de Personas', 'Sodexo', 'marcela@sodexo.test', 'saved'),
  ('ca200000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001',
   'Rafael Díaz', 'Gerente', 'Otra', 'rafael@otra.test', 'saved'),
  ('ca200000-0000-4000-8000-000000000003', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001',
   'Susana Mora', 'Gerenta', 'Ganada', 'susana@ganada.test', 'saved');
insert into public.enriched_leads (id, user_id, organization_id)
values ('pgtap-pipeline-enriched', 'ca000000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001');

insert into public.unified_crm_data (id, organization_id, stage)
values
  ('lead_saved|ca200000-0000-4000-8000-000000000002', 'ca100000-0000-4000-8000-000000000001', 'meeting'),
  ('lead_saved|ca200000-0000-4000-8000-000000000003', 'ca100000-0000-4000-8000-000000000001', 'closed_won');

-- Events leave suggestions; only the service role writes them.
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'contacted', 'x', 'test')$$,
  '42501', null,
  'members cannot write suggestions'
);
reset role;

select throws_ok(
  $$select public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'won', 'x', 'test')$$,
  '22023', null,
  'an unknown stage is refused'
);
select is(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000009', 'contacted', 'Correo entregado', 'delivered'),
  null::uuid,
  'a lead that is not in the organization gets no suggestion'
);
select ok(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'contacted', 'Se entregó el correo', 'delivered', '{"event":"delivered"}') is not null,
  'a send suggests Contactado for a new lead'
);
select results_eq(
  $$select crm_id, from_stage, to_stage, status from public.crm_stage_suggestions where reason = 'Se entregó el correo'$$,
  $$values ('lead_saved|ca200000-0000-4000-8000-000000000001'::text, null::text, 'contacted'::text, 'pending'::text)$$,
  'the suggestion points at the saved lead, from no stage'
);
select ok(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'engaged', 'Respondió con interés', 'positive_reply') is not null,
  'a later reply raises the same pending suggestion'
);
select is(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000001', 'contacted', 'Abrió el correo', 'open'),
  null::uuid,
  'an earlier stage never lowers the pending suggestion'
);
select results_eq(
  $$select count(*)::integer, max(to_stage), max(reason) from public.crm_stage_suggestions where crm_id = 'lead_saved|ca200000-0000-4000-8000-000000000001'$$,
  $$values (1, 'engaged'::text, 'Respondió con interés'::text)$$,
  'one pending suggestion per lead, the furthest one'
);
select ok(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'pgtap-pipeline-enriched', 'contacted', 'Se entregó el correo', 'delivered') is not null,
  'an enriched lead gets a suggestion'
);
select is(
  (select crm_id from public.crm_stage_suggestions where crm_id like 'lead_enriched|%'),
  'lead_enriched|pgtap-pipeline-enriched',
  'on the enriched lead row the pipeline shows'
);
select is(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000002', 'contacted', 'Abrió el correo', 'open'),
  null::uuid,
  'nothing moves a lead backwards (meeting stays)'
);
select is(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000003', 'closed_lost', 'Rebotó', 'bounce'),
  null::uuid,
  'a closed lead is never moved by an event'
);
select ok(
  public.suggest_crm_stage_v1('ca100000-0000-4000-8000-000000000001', 'ca200000-0000-4000-8000-000000000002', 'closed_lost', 'El correo rebotó', 'bounce') is not null,
  'a loss can be suggested from any open stage'
);

-- People decide: an outsider cannot, a member can.
select set_config('pgtap.marcela_suggestion',
  (select id::text from public.crm_stage_suggestions where crm_id = 'lead_saved|ca200000-0000-4000-8000-000000000001'), true);
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.crm_stage_suggestions),
  0,
  'another organization does not see these suggestions'
);
select throws_ok(
  $$select public.decide_crm_stage_suggestions_v1(array[current_setting('pgtap.marcela_suggestion')::uuid], 'accept')$$,
  '42501', null,
  'an outsider cannot decide'
);
reset role;

select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.crm_stage_suggestions where status = 'pending'),
  3,
  'a member sees the pending suggestions of their organization'
);
select throws_ok(
  $$select public.decide_crm_stage_suggestions_v1(array[]::uuid[], 'accept')$$,
  '22023', null,
  'an empty selection is refused'
);
select throws_ok(
  $$select public.decide_crm_stage_suggestions_v1(array[gen_random_uuid()], 'maybe')$$,
  '22023', null,
  'an unknown decision is refused'
);
reset role;

-- Before accepting, Marcela was moved by hand to Reunión, past her suggestion: accepting must not move her back.
insert into public.unified_crm_data (id, organization_id, stage)
values ('lead_saved|ca200000-0000-4000-8000-000000000001', 'ca100000-0000-4000-8000-000000000001', 'meeting');
select set_config('request.jwt.claim.sub', 'ca000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.decide_crm_stage_suggestions_v1(
    array(select id from public.crm_stage_suggestions where crm_id in ('lead_saved|ca200000-0000-4000-8000-000000000001', 'lead_saved|ca200000-0000-4000-8000-000000000002')),
    'accept'),
  '{"accepted": 1, "dismissed": 0, "superseded": 1}'::jsonb,
  'accept all moves what can move and supersedes what a manual move already passed'
);
select is(
  public.decide_crm_stage_suggestions_v1(
    array(select id from public.crm_stage_suggestions where crm_id = 'lead_enriched|pgtap-pipeline-enriched'), 'dismiss'),
  '{"accepted": 0, "dismissed": 1, "superseded": 0}'::jsonb,
  'a dismissed suggestion moves nothing'
);
reset role;

select results_eq(
  $$select id, stage from public.unified_crm_data where id like 'lead_%' order by id$$,
  $$values ('lead_saved|ca200000-0000-4000-8000-000000000001'::text, 'meeting'::text),
           ('lead_saved|ca200000-0000-4000-8000-000000000002'::text, 'closed_lost'::text),
           ('lead_saved|ca200000-0000-4000-8000-000000000003'::text, 'closed_won'::text)$$,
  'the loss moved Rafael, Marcela kept her manual stage and the dismissed lead has no row'
);
select ok(
  (select bool_and(decided_at is not null and decided_by = 'ca000000-0000-4000-8000-000000000001')
   from public.crm_stage_suggestions),
  'each decision records who and when'
);
select is(
  (select count(*)::integer from public.crm_stage_suggestions where status = 'pending'),
  0,
  'nothing is left pending'
);

select * from finish();
rollback;
