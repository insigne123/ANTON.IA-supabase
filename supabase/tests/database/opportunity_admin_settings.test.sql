begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(5);
insert into auth.users(id,email) values ('d9100000-0000-4000-8000-000000000001','admin-settings@antonia.test');
insert into organizations(id,name) values('da100000-0000-4000-8000-000000000001','Admin settings test');
insert into opportunity_company_context(organization_id,offer,services,approved_by)
 values('da100000-0000-4000-8000-000000000001','Guardias de seguridad y aseo industrial para empresas.','{Guardias}','d9100000-0000-4000-8000-000000000001');

select has_column('public','opportunity_company_context','admin_settings','the rules and saved searches live beside the offer');
select is((select admin_settings from opportunity_company_context where organization_id='da100000-0000-4000-8000-000000000001'),'{}'::jsonb,'an offer saved before has no rule and no saved search');
select lives_ok($$update opportunity_company_context set admin_settings='{"rules":[{"id":"r1","category":"seguridad","minAmount":null,"userId":"d9100000-0000-4000-8000-000000000001"}],"searches":[]}' where organization_id='da100000-0000-4000-8000-000000000001'$$,'the rules are saved');
select throws_ok($$update opportunity_company_context set admin_settings='[]' where organization_id='da100000-0000-4000-8000-000000000001'$$,'23514',null,'only an object');
select throws_ok($$update opportunity_company_context set admin_settings=jsonb_build_object('searches',(select jsonb_agg(repeat('x',200)) from generate_series(1,400))) where organization_id='da100000-0000-4000-8000-000000000001'$$,'23514',null,'never bigger than 32 KB');

select * from finish();
rollback;
