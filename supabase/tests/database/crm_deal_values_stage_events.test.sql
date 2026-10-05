begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(16);

insert into auth.users (id, email)
values
  ('ce000000-0000-4000-8000-000000000001', 'crm-panel-member@antonia.test'),
  ('ce000000-0000-4000-8000-000000000002', 'crm-panel-outsider@antonia.test');
insert into public.organizations (id, name)
values
  ('ce100000-0000-4000-8000-000000000001', 'CRM Panel Team'),
  ('ce100000-0000-4000-8000-000000000002', 'CRM Panel Other');
insert into public.organization_members (organization_id, user_id, role)
values
  ('ce100000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'member'),
  ('ce100000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'owner');

select has_column('public', 'unified_crm_data', 'deal_value', 'each deal can carry its value');
select col_default_is('public', 'unified_crm_data', 'deal_currency', 'CLP'::text, 'in Chilean pesos unless said otherwise');
select has_table('public', 'crm_stage_events', 'the stage history has its own table');
select ok((select relrowsecurity from pg_class where oid = 'public.crm_stage_events'::regclass), 'with RLS on');

-- A new lead with a stage, then moved by a member: dates on the row and the history, written by the triggers.
insert into public.unified_crm_data (id, organization_id, stage, deal_value)
values ('lead_saved|ce-1', 'ce100000-0000-4000-8000-000000000001', 'contacted', 4500000);
select is((select count(*)::int from public.crm_stage_events where crm_id = 'lead_saved|ce-1' and from_stage is null and to_stage = 'contacted'), 1,
  'a new lead with a stage starts its history');

select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
update public.unified_crm_data set stage = 'meeting' where id = 'lead_saved|ce-1';
update public.unified_crm_data set notes = 'llamar el lunes' where id = 'lead_saved|ce-1';
update public.unified_crm_data set stage = 'meeting' where id = 'lead_saved|ce-1';
select is((select count(*)::int from public.crm_stage_events where crm_id = 'lead_saved|ce-1'), 2,
  'only a real change of stage is logged, not a note or the same stage again');
select is((select changed_by from public.crm_stage_events where crm_id = 'lead_saved|ce-1' and to_stage = 'meeting'),
  'ce000000-0000-4000-8000-000000000001'::uuid, 'it records who moved it');
select ok((select stage_changed_at is not null and won_at is null from public.unified_crm_data where id = 'lead_saved|ce-1'),
  'the row knows when it last changed stage');
select throws_ok($$
  insert into public.crm_stage_events (organization_id, crm_id, to_stage) values ('ce100000-0000-4000-8000-000000000001', 'x', 'closed_won')
$$, '42501', null, 'members cannot write the history by hand');
select throws_ok($$ delete from public.crm_stage_events $$, '42501', null, 'nor erase it');
update public.unified_crm_data set stage = 'closed_won' where id = 'lead_saved|ce-1';
reset role;
select ok((select won_at is not null and lost_at is null from public.unified_crm_data where id = 'lead_saved|ce-1'), 'winning sets won_at');

-- Accepting a suggestion upserts the row: one event, not two.
select set_config('app.crm_stage_source', 'suggestion', true);
insert into public.unified_crm_data (id, organization_id, stage)
values ('lead_saved|ce-1', 'ce100000-0000-4000-8000-000000000001', 'closed_lost')
on conflict (id) do update set stage = excluded.stage;
select set_config('app.crm_stage_source', '', true);
select is((select count(*)::int from public.crm_stage_events where crm_id = 'lead_saved|ce-1' and to_stage = 'closed_lost'), 1,
  'an upsert that updates logs once');
select is((select source from public.crm_stage_events where crm_id = 'lead_saved|ce-1' and to_stage = 'closed_lost'), 'suggestion',
  'with the source its caller named');
select ok((select lost_at is not null and won_at is null from public.unified_crm_data where id = 'lead_saved|ce-1'), 'losing clears won_at');

-- Each organization reads only its own history.
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*)::int from public.crm_stage_events where organization_id = 'ce100000-0000-4000-8000-000000000001'), 0,
  'another organization sees none of it');
reset role;

select throws_ok($$
  update public.unified_crm_data set deal_value = -5 where id = 'lead_saved|ce-1'
$$, '23514', null, 'a deal cannot be worth less than zero');

select * from finish();
rollback;
