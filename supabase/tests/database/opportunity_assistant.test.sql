begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(11);
insert into auth.users(id,email) values ('e6000000-0000-4000-8000-000000000001','assistant-member@antonia.test');
insert into organizations(id,name) values('e7000000-0000-4000-8000-000000000001','Assistant test');
insert into organization_members(organization_id,user_id,role) values('e7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','member');
select ok((select relrowsecurity from pg_class where relname='opportunity_assistant_threads'),'threads have RLS');
select ok((select relrowsecurity from pg_class where relname='opportunity_assistant_messages'),'messages have RLS');
select ok(not has_table_privilege('authenticated','opportunity_assistant_messages','select'),'no direct browser read');
select ok(not has_table_privilege('anon','opportunity_assistant_threads','insert'),'no anonymous write');
insert into opportunity_assistant_threads(id,organization_id,user_id,title)
  values('e8000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','¿Qué cierra esta semana?');
select lives_ok($$insert into opportunity_assistant_messages(organization_id,thread_id,user_id,request_id,question)
  values('e7000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','¿Qué cierra esta semana?')$$,'a question is saved');
select throws_ok($$insert into opportunity_assistant_messages(organization_id,thread_id,user_id,request_id,question)
  values('e7000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','Otra vez')$$,'23505',null,'one message per request');
select throws_ok($$insert into opportunity_assistant_messages(organization_id,thread_id,user_id,request_id,question)
  values('e7000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000002',repeat('x',2001))$$,'23514',null,'questions stay short');
select lives_ok($$insert into opportunity_jobs(organization_id,requested_by,kind,dedupe_key,payload)
  values('e7000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','assistant','assistant:e6000000-0000-4000-8000-000000000001:e9000000-0000-4000-8000-000000000001','{"requestId":"e9000000-0000-4000-8000-000000000001"}')$$,'the assistant is a job kind');
select is((select kind from opportunity_claim_job()),'assistant','the worker takes a member''s assistant answer, which has no opportunity');
select ok(not has_function_privilege('authenticated','opportunity_claim_job()','execute'),'only the server claims jobs');
delete from opportunity_assistant_threads where id='e8000000-0000-4000-8000-000000000001';
select is((select count(*)::int from opportunity_assistant_messages where thread_id='e8000000-0000-4000-8000-000000000001'),0,'messages leave with their conversation');
select * from finish();
rollback;
