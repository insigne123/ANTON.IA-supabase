begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(8);
insert into auth.users(id,email) values ('a6000000-0000-4000-8000-000000000001','fit-member@antonia.test');
insert into organizations(id,name) values('a7000000-0000-4000-8000-000000000001','Fit test');
insert into commercial_opportunities(id,organization_id,kind,dedupe_key,title) values('a8000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','tender','fit','Aseo Hospital');
insert into opportunity_jobs(id,organization_id,opportunity_id,requested_by,kind,dedupe_key)
  values('a9000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','research','fit-report');
insert into opportunity_reports(id,organization_id,opportunity_id,job_id,content_hash,profile_revision,report)
  values('aa000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001','h',1,'{}');
select ok((select relrowsecurity from pg_class where relname='opportunity_requirement_fit'),'readings have RLS');
select ok(not has_table_privilege('authenticated','opportunity_requirement_fit','select'),'no direct browser read');
select lives_ok($$insert into opportunity_requirement_fit(organization_id,opportunity_id,report_id,profile_revision,items)
  values('a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001',3,'{"req:0123456789abcdef":{"fit":"meets"}}')$$,'a reading is saved');
select throws_ok($$insert into opportunity_requirement_fit(organization_id,opportunity_id,report_id,profile_revision,items)
  values('a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001',3,'{}')$$,'23505',null,'one reading per report and profile version');
select throws_ok($$insert into opportunity_requirement_fit(organization_id,opportunity_id,report_id,profile_revision,items)
  values('a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001',4,'[]')$$,'23514',null,'items are an object');
select lives_ok($$insert into opportunity_jobs(organization_id,opportunity_id,requested_by,kind,dedupe_key)
  values('a7000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','fit','fit:test')$$,'the reading is a job kind');
delete from opportunity_reports where id='aa000000-0000-4000-8000-000000000001';
select is((select count(*)::int from opportunity_requirement_fit where report_id='aa000000-0000-4000-8000-000000000001'),0,'readings leave with their report');
select is((select confdeltype::text from pg_constraint where conrelid='public.opportunity_requirement_fit'::regclass and contype='f' and confrelid='public.commercial_opportunities'::regclass),'c','and with their opportunity');
select * from finish();
rollback;
