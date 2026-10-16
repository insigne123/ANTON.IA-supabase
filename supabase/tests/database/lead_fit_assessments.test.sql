begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

select has_table('public', 'lead_fit_assessments', 'lead_fit_assessments exists');
select ok((select relrowsecurity from pg_class where oid = 'public.lead_fit_assessments'::regclass), 'lead_fit_assessments has RLS');
select ok(not has_table_privilege('anon', 'public.lead_fit_assessments', 'select'), 'anon cannot read estimates');
select ok(not has_table_privilege('authenticated', 'public.lead_fit_assessments', 'insert'), 'session clients cannot write estimates');
select ok(has_table_privilege('authenticated', 'public.lead_fit_assessments', 'select'), 'session clients read theirs through RLS');
select policies_are('public', 'lead_fit_assessments', array['Members read their own lead fit'], 'only the read policy');

-- One row per person and stage, inside the bounds the page shows.
insert into public.organizations (id, name) values ('b1000000-0000-4000-8000-000000000001', 'pgtap lead fit');
insert into auth.users (id, email) values ('b2000000-0000-4000-8000-000000000001', 'pgtap-lead-fit@example.com');
insert into public.lead_fit_assessments (organization_id, user_id, lead_key, stage, probability, summary, factors, model, input_hash)
values ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'li:linkedin.com/in/ana', 'search', 72, 'Calza el cargo.',
  '[{"effect":"up","text":"Gerente de Personas"}]', 'claude-haiku-5-5', 'h1');
select throws_ok(
  $$insert into public.lead_fit_assessments (organization_id, user_id, lead_key, stage, probability, summary, model, input_hash)
    values ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'li:linkedin.com/in/ana', 'search', 50, 'Otra.', 'claude-haiku-5-5', 'h2')$$,
  '23505', null, 'a person has one estimate per stage');
select throws_ok(
  $$insert into public.lead_fit_assessments (organization_id, user_id, lead_key, stage, probability, summary, model, input_hash)
    values ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'li:linkedin.com/in/ana', 'saved', 140, 'Fuera.', 'claude-haiku-5-5', 'h3')$$,
  '23514', null, 'a probability is between 0 and 100');
select throws_ok(
  $$insert into public.lead_fit_assessments (organization_id, user_id, lead_key, stage, probability, summary, model, input_hash)
    values ('b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'li:linkedin.com/in/ana', 'contacted', 40, 'Etapa.', 'claude-haiku-5-5', 'h4')$$,
  '23514', null, 'only the three stages');

select * from finish();
rollback;
