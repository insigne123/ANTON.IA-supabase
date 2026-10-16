begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(8);
insert into auth.users(id,email) values ('d6000000-0000-4000-8000-000000000001','marks-admin@antonia.test');
insert into organizations(id,name) values('d7000000-0000-4000-8000-000000000001','Marks test'),('d7000000-0000-4000-8000-000000000002','Other marks test');
insert into commercial_opportunities(id,organization_id,kind,dedupe_key,title) values('d8000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001','private','marks','Marks test');
select ok((select relrowsecurity from pg_class where relname='opportunity_report_marks'),'marks have RLS');
select ok(not has_table_privilege('authenticated','opportunity_report_marks','select'),'no direct browser read');
select ok(not has_table_privilege('anon','opportunity_report_marks','insert'),'no anonymous write');
select lives_ok($$insert into opportunity_report_marks(organization_id,opportunity_id,item_key,done,note,updated_by)
  values('d7000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','req:0123456789abcdef',true,'Pedir la boleta al banco','d6000000-0000-4000-8000-000000000001')$$,'a mark is saved');
select throws_ok($$insert into opportunity_report_marks(organization_id,opportunity_id,item_key) values('d7000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','Requisito libre')$$,'23514',null,'keys are kind:hash only');
select throws_ok($$insert into opportunity_report_marks(organization_id,opportunity_id,item_key) values('d7000000-0000-4000-8000-000000000002','d8000000-0000-4000-8000-000000000001','req:fedcba9876543210')$$,'23503',null,'another workspace cannot mark this opportunity');
select throws_ok($$insert into opportunity_report_marks(organization_id,opportunity_id,item_key,note) values('d7000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','req:fedcba9876543210',repeat('x',2001))$$,'23514',null,'notes stay short');
delete from commercial_opportunities where id='d8000000-0000-4000-8000-000000000001';
select is((select count(*)::int from opportunity_report_marks),0,'marks leave with their opportunity');
select * from finish();
rollback;
