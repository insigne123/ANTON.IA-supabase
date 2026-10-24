begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(5);
insert into auth.users(id,email) values ('d9000000-0000-4000-8000-000000000001','search-admin@antonia.test');
insert into organizations(id,name) values('da000000-0000-4000-8000-000000000001','Search settings test');
insert into opportunity_company_context(organization_id,offer,services,approved_by)
 values('da000000-0000-4000-8000-000000000001','Verificación de antecedentes laborales para empresas.','{Verificación de antecedentes}','d9000000-0000-4000-8000-000000000001');

select has_column('public','opportunity_company_context','search','the search settings live beside the offer');
select is((select search from opportunity_company_context where organization_id='da000000-0000-4000-8000-000000000001'),'{}'::jsonb,'an offer saved before keeps every source and no rule');
select lives_ok($$update opportunity_company_context set search='{"sources":{"posts":false},"hiringEvery":"week","tenders":{"minAmount":5000000}}' where organization_id='da000000-0000-4000-8000-000000000001'$$,'the settings are saved');
select throws_ok($$update opportunity_company_context set search='[]' where organization_id='da000000-0000-4000-8000-000000000001'$$,'23514',null,'only an object');
-- A new offer resets the criteria the AI derives, never the settings.
update opportunity_company_context set offer='Verificación de antecedentes laborales y judiciales para empresas.',criteria='{}',revision=revision+1 where organization_id='da000000-0000-4000-8000-000000000001';
select is((select search->'sources'->>'posts' from opportunity_company_context where organization_id='da000000-0000-4000-8000-000000000001'),'false','a new offer keeps them');

select * from finish();
rollback;
