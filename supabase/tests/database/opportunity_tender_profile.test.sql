begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(8);
insert into auth.users(id,email) values ('f6000000-0000-4000-8000-000000000001','profile-admin@antonia.test');
insert into organizations(id,name) values('f7000000-0000-4000-8000-000000000001','Tender profile test');
insert into organization_members(organization_id,user_id,role) values('f7000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001','admin');
select ok((select relrowsecurity from pg_class where relname='opportunity_tender_profile'),'the profile has RLS');
select ok(not has_table_privilege('authenticated','opportunity_tender_profile','select'),'no direct browser read');
select ok(not has_table_privilege('anon','opportunity_tender_profile','insert'),'no anonymous write');
select lives_ok($$insert into opportunity_tender_profile(organization_id,answers,updated_by)
  values('f7000000-0000-4000-8000-000000000001','{"legalName":"Aseo Sur SpA","regions":["Los Lagos"]}','f6000000-0000-4000-8000-000000000001')$$,'a profile is saved');
select throws_ok($$insert into opportunity_tender_profile(organization_id,answers) values('f7000000-0000-4000-8000-000000000001','{}')$$,'23505',null,'one profile per workspace');
select throws_ok($$update opportunity_tender_profile set answers='[1,2]' where organization_id='f7000000-0000-4000-8000-000000000001'$$,'23514',null,'answers are an object');
select lives_ok($$insert into opportunity_jobs(organization_id,requested_by,kind,dedupe_key) values('f7000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001','profile','profile:test')$$,'the AI suggestion is a job kind');
select is((select confdeltype::text from pg_constraint where conname='opportunity_tender_profile_organization_id_fkey'),'c','the profile leaves with its workspace');
select * from finish();
rollback;
