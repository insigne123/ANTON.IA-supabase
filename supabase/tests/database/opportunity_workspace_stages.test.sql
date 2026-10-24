begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(16);
insert into auth.users(id,email) values
 ('d6000000-0000-4000-8000-000000000001','stages-admin@antonia.test'),('d6000000-0000-4000-8000-000000000002','stages-member@antonia.test'),('d6000000-0000-4000-8000-000000000003','stages-other@antonia.test');
insert into organizations(id,name) values('d7000000-0000-4000-8000-000000000001','Stages test'),('d7000000-0000-4000-8000-000000000002','Other stages test');
insert into organization_members(organization_id,user_id,role) values
 ('d7000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','admin'),
 ('d7000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000002','member'),
 ('d7000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000003','admin');
-- Four to review (one closed already), one recommended and one left out by the AI.
insert into commercial_opportunities(id,organization_id,kind,dedupe_key,title,score,deadline_at,amount,data) values
 ('d8000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001','tender','s1','Servicio de guardias',70,now()+interval '9 days',48000000,'{"evaluation":"review"}'),
 ('d8000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000001','tender','s2','Aseo de oficinas',60,now()+interval '3 days',null,'{"evaluation":"review"}'),
 ('d8000000-0000-4000-8000-000000000003','d7000000-0000-4000-8000-000000000001','compra_agil','s3','Guardias para un evento',50,null,1500000,'{"evaluation":"pending"}'),
 ('d8000000-0000-4000-8000-000000000004','d7000000-0000-4000-8000-000000000001','tender','s4','Vigilancia cerrada',80,now()-interval '2 days',null,'{"evaluation":"review"}'),
 ('d8000000-0000-4000-8000-000000000005','d7000000-0000-4000-8000-000000000001','tender','s5','Software de turnos',90,now()+interval '20 days',230000000,'{"evaluation":"recommended"}'),
 ('d8000000-0000-4000-8000-000000000006','d7000000-0000-4000-8000-000000000001','tender','s6','Obras civiles',20,now()+interval '20 days',null,'{"evaluation":"excluded"}');
create temporary table stage_args as select 'd7000000-0000-4000-8000-000000000001'::uuid as org,'d6000000-0000-4000-8000-000000000001'::uuid as admin,'d6000000-0000-4000-8000-000000000002'::uuid as member;

select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,a.admin,array['open'],array['review','pending'],'','{}','{}',true,'priority',100,0)),3,'«Por revisar» keeps what can still be bid');
select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,a.admin,'{}','{}','','{}','{}',false,'priority',100,0)),6,'«Todas» keeps everything');
select is((select array_agg(id order by ordinality)::text from stage_args a,opportunity_workspace_page(a.org,a.admin,array['open'],array['review','pending'],'','{}','{}',true,'deadline',100,0) with ordinality),
 '{d8000000-0000-4000-8000-000000000002,d8000000-0000-4000-8000-000000000001,d8000000-0000-4000-8000-000000000003}','soonest to close first, without a deadline last');
select is((select id from stage_args a,opportunity_workspace_page(a.org,a.admin,'{}','{}','','{}','{}',false,'amount',1,0)),'d8000000-0000-4000-8000-000000000005'::uuid,'largest amount first');
select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,a.admin,array['open'],'{}','guard','{tender,compra_agil}','{}',true,'priority',100,0)),2,'words and sources narrow the page');
select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,a.admin,array['open'],'{}','','{}',array['aseo'],true,'priority',100,0)),1,'a line of service narrows the page');

-- Assigned to the member: it leaves «Por revisar» for «Asignadas», and the member reads it and nothing else.
select is(opportunity_assign('d7000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001',0,null,array['d6000000-0000-4000-8000-000000000002']::uuid[],null,'',null),1::bigint,'assigned');
select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,a.admin,array['open'],array['review','pending'],'','{}','{}',true,'priority',100,0)),2,'an assigned opportunity leaves «Por revisar»');
select is((select array_agg(id)::text from stage_args a,opportunity_workspace_page(a.org,a.admin,array['assigned'],'{}','','{}','{}',true,'priority',100,0)),'{d8000000-0000-4000-8000-000000000001}','and is in «Asignadas»');
select is((select array_agg(id)::text from stage_args a,opportunity_workspace_page(a.org,a.member,'{}','{}','','{}','{}',false,'priority',100,0)),'{d8000000-0000-4000-8000-000000000001}','a member reads only what was assigned to them');
select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,'d6000000-0000-4000-8000-000000000003','{}','{}','','{}','{}',false,'priority',100,0)),0,'another workspace''s administrator reads nothing');

-- Put aside: a work record in «Archivadas» takes it out of the open ones, whatever the AI said.
insert into opportunity_work(organization_id,opportunity_id,state,revision) values('d7000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002','archived',1);
select is((select count(*)::int from stage_args a,opportunity_workspace_page(a.org,a.admin,array['open'],array['review','pending'],'','{}','{}',true,'priority',100,0)),1,'a discarded opportunity leaves «Por revisar»');
select is((select string_agg(stage||':'||coalesce(evaluation,'-')||':'||total,',' order by stage,evaluation) from stage_args a,opportunity_workspace_counts(a.org,a.admin,'','{}','{}',true)),
 'archived:review:1,assigned:review:1,open:excluded:1,open:pending:1,open:recommended:1','the counts are the stages and, for the open ones, the evaluation');
select is((select string_agg(stage||':'||total,',') from stage_args a,opportunity_workspace_counts(a.org,a.member,'','{}','{}',true)),'assigned:1','a member counts only their own');
select ok(not has_function_privilege('authenticated','opportunity_workspace_page(uuid,uuid,text[],text[],text,text[],text[],boolean,text,integer,integer)','execute'),'no direct browser read of the pages');
select ok(not has_function_privilege('anon','opportunity_workspace_counts(uuid,uuid,text,text[],text[],boolean)','execute'),'no direct browser read of the counts');
select * from finish();
rollback;
