begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(8);

select ok((select relrowsecurity from pg_class where oid = 'public.organization_company_profile'::regclass), 'the company profile has RLS');
select ok(has_table_privilege('authenticated', 'public.organization_company_profile', 'select'), 'a member reads it with their session');
select ok(not has_table_privilege('authenticated', 'public.organization_company_profile', 'update'), 'only the server writes it');
select ok(not has_table_privilege('anon', 'public.organization_company_profile', 'select'), 'anon cannot read it');
select policies_are('public', 'organization_company_profile', array['organization_company_profile_read'], 'one policy: members read');

insert into public.organizations (id, name) values ('d3000000-0000-4000-8000-000000000001', 'pgtap ficha');
select lives_ok(
  $$insert into public.organization_company_profile (organization_id, fields) values ('d3000000-0000-4000-8000-000000000001', '{"companyName":"Yago SpA"}')$$,
  'a profile per organization');
select throws_ok(
  $$insert into public.organization_company_profile (organization_id, fields) values ('d3000000-0000-4000-8000-000000000001', '{}')$$,
  '23505', null, 'never two for the same organization');
delete from public.organizations where id = 'd3000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.organization_company_profile where organization_id = 'd3000000-0000-4000-8000-000000000001'), 0,
  'the profile goes with its organization');

select * from finish();
rollback;
