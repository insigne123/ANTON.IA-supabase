begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(7);

-- The owner and the QA account pass the rule; anyone else needs open_to_grants, on since 20261019100000 (Cowork for every
-- account). Closed here to check the names, as the rule was before.
select results_eq($$select open_to_grants from public.cowork_access_policy$$, $$values (true)$$, 'Cowork is open to every account');
update public.cowork_access_policy set open_to_grants = false;
select ok(public.cowork_open_access('nicolas.yarur.g@yago.cl'), 'the owner passes');
select ok(public.cowork_open_access(' Nicolas.Yarur.G+QA@yago.cl '), 'the QA account passes');
select ok(not public.cowork_open_access('nicolas.yarur.g+otro@yago.cl'), 'another alias does not');
select ok(not public.cowork_open_access(null), 'no email does not');
select ok(not public.cowork_open_access('pgtap-sin-nombre@antonia.test'), 'closed, a name not on the list does not pass');
select ok(not has_function_privilege('authenticated', 'public.cowork_open_access(text)', 'execute')
  and has_function_privilege('service_role', 'public.cowork_open_access(text)', 'execute'), 'the rule stays the service role''s');

select * from finish();
rollback;
