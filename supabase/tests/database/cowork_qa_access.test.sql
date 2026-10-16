begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

-- The owner and the QA account pass the rule; anyone else needs open_to_grants, which stays off.
select ok(public.cowork_open_access('nicolas.yarur.g@yago.cl'), 'the owner passes');
select ok(public.cowork_open_access(' Nicolas.Yarur.G+QA@yago.cl '), 'the QA account passes');
select ok(not public.cowork_open_access('nicolas.yarur.g+otro@yago.cl'), 'another alias does not');
select ok(not public.cowork_open_access(null), 'no email does not');
select results_eq($$select open_to_grants from public.cowork_access_policy$$, $$values (false)$$, 'the policy stays closed');
select ok(not has_function_privilege('authenticated', 'public.cowork_open_access(text)', 'execute')
  and has_function_privilege('service_role', 'public.cowork_open_access(text)', 'execute'), 'the rule stays the service role''s');

select * from finish();
rollback;
