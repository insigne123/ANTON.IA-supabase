begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(18);
insert into auth.users(id,email) values
 ('d1000000-0000-4000-8000-000000000001','op-admin@antonia.test'),('d1000000-0000-4000-8000-000000000002','op-member@antonia.test'),('d1000000-0000-4000-8000-000000000003','op-other@antonia.test');
insert into organizations(id,name) values('d2000000-0000-4000-8000-000000000001','Opportunity test'),('d2000000-0000-4000-8000-000000000002','Other opportunity test');
insert into organization_members(organization_id,user_id,role) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','admin'),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','member'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003','admin');
insert into commercial_opportunities(id,organization_id,kind,dedupe_key,title) values('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','private','invitation','Invitation test');
select ok(opportunity_can_read('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001'),'admin reads the workspace');
select ok(not opportunity_can_read('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001'),'unassigned members cannot read');
select throws_ok($$select opportunity_assign('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001',0,null,array['d1000000-0000-4000-8000-000000000002']::uuid[],null,'',null)$$,'42501','OPPORTUNITY_ADMIN_REQUIRED','member cannot self assign');
select is(opportunity_assign('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',0,null,array['d1000000-0000-4000-8000-000000000002']::uuid[],null,'Prepare',null),1::bigint,'assignment revision increments');
select ok(opportunity_can_read('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001'),'assigned member can read');
select is((select count(*)::int from opportunity_notifications where opportunity_id='d3000000-0000-4000-8000-000000000001'),1,'notification created transactionally');
select throws_ok($$select opportunity_assign('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',0,null,array['d1000000-0000-4000-8000-000000000002']::uuid[],null,'',null)$$,'40001','OPPORTUNITY_REVISION_CONFLICT','stale admin edit cannot overwrite');
select ok(not opportunity_can_read('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000001'),'other tenant admin cannot read');
select is(opportunity_assign('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',1,null,'{}'::uuid[],null,'',null),2::bigint,'unassign completes');
select is((select count(*)::int from opportunity_workspace_list('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002','all','',0)),0,'revoked member list empty');
select ok(not has_table_privilege('authenticated','opportunity_documents','select'),'no direct browser read');
select ok(not has_function_privilege('authenticated','opportunity_assign(uuid,uuid,uuid,bigint,uuid,uuid[],uuid,text,timestamptz)','execute'),'no direct browser assignment');
select ok((select bool_and(relrowsecurity) from pg_class where relname like 'opportunity_%' and relkind='r'),'all new tables have RLS');
select ok(not (select public from storage.buckets where id='opportunity-documents'),'documents bucket private');
insert into opportunity_jobs(id,organization_id,requested_by,kind,dedupe_key,state,lease_token,lease_until)
 values('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','criteria','budget-test','running','d5000000-0000-4000-8000-000000000001',now()+interval '5 minutes');
select ok((opportunity_budget_reserve('d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','one','evaluation',10000,'d5000000-0000-4000-8000-000000000001')->>'fresh')::boolean,'fresh reservation before spend');
select ok(not (opportunity_budget_reserve('d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','one','evaluation',10000,'d5000000-0000-4000-8000-000000000001')->>'fresh')::boolean,'replay does not reserve twice');
update opportunity_budget_months set spent_micro_usd=19995000 where organization_id='d2000000-0000-4000-8000-000000000001';
select ok(not (opportunity_budget_reserve('d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','two','evaluation',10000,'d5000000-0000-4000-8000-000000000001')->>'admitted')::boolean,'global cap counts pending exposure');
select throws_ok($$select opportunity_budget_reserve('d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','stale','evaluation',10000,'d5000000-0000-4000-8000-000000000002')$$,'P0001','OPPORTUNITY_JOB_REQUIRED','old lease cannot spend');
select * from finish();
rollback;
