begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(15);
insert into auth.users(id,email) values ('b6000000-0000-4000-8000-000000000001','market-admin@antonia.test');
insert into organizations(id,name) values('b7000000-0000-4000-8000-000000000001','Market test');
-- Ids and RUTs far from real ones: the test also runs on a copy loaded with ChileCompra's data.
insert into public_procurement_agencies(id,name,name_key) values(2000000001,'I MUNICIPALIDAD DE PRUEBA','i municipalidad de prueba');
insert into public_procurement_suppliers(id,rut,name) values(2000000001,'1-9','Aseo Norte SpA'),(2000000002,'2-7','Limpia Sur Ltda');
-- Awarded on 15 Jan 2025 for 24 months: ends on 15 Jan 2027, by the calendar.
insert into public_procurement_tenders(id,code,name,agency_id,status,currency,awarded_amount,published_on,awarded_on,duration_months,category,source_month)
  values(2000000001,'9-1-LE25','Servicio de aseo edificio consistorial',2000000001,'adjudicada','CLP',90000000,'2024-12-01','2025-01-15',24,'Servicios de limpieza','2024-12-01'),
        (2000000002,'9-2-LE26','Servicio de aseo plazas',2000000001,'adjudicada','CLP',50000000,current_date - 30,current_date - 20,6,'Servicios de limpieza',date_trunc('month',current_date)::date),
        (2000000003,'9-3-LE25','MANTENCIÓN DE ÁREAS VERDES',2000000001,'cerrada','CLP',null,'2025-03-01',null,null,'Servicios de jardinería','2025-03-01');
insert into public_procurement_bids(tender_id,supplier_id,offered_amount,awarded_amount,selected)
  values(2000000001,2000000001,90000000,90000000,true),(2000000001,2000000002,95000000,null,false),(2000000002,2000000002,50000000,50000000,true),(2000000002,2000000001,52000000,null,false);

select ok((select bool_and(relrowsecurity) from pg_class where relname in ('public_procurement_agencies','public_procurement_suppliers','public_procurement_tenders','public_procurement_bids','public_procurement_loads','opportunity_competitors')),'every table has RLS');
select ok(not has_table_privilege('authenticated','public_procurement_tenders','select'),'no direct browser read of the history');
select ok(not has_table_privilege('anon','opportunity_competitors','select'),'nor of the competitors a workspace follows');
select ok(not has_function_privilege('authenticated','public_procurement_expiring(date,date,text[],integer)','execute'),'the functions are for the server');
select is((select ends_on from public_procurement_expiring('2027-01-01','2027-02-01',array['%aseo%'],1000) where tender_id=2000000001),'2027-01-15'::date,'a contract ends by the calendar');
select is((select winner_name from public_procurement_expiring('2027-01-01','2027-02-01',array['%aseo%'],1000) where tender_id=2000000001),'Aseo Norte SpA','with who holds it');
select is((select count(*)::int from public_procurement_expiring('2027-01-01','2027-02-01',array['%guardias%'],1000) where tender_id=2000000001),0,'only what says the words');
-- The functions search the folded name and category, kept on every write and joined by a line break.
select is((select search_text from public_procurement_tenders where id=2000000003),E'mantencion de areas verdes\nservicios de jardineria','the folded text is kept on each write');
select is((select count(*)::int from public_procurement_expiring('2027-01-01','2027-02-01',array['%limpieza%'],1000) where tender_id=2000000001),1,'a word in the category alone is enough');
select is((select count(*)::int from public_procurement_expiring('2027-01-01','2027-02-01',array['%consistorial servicios%'],1000) where tender_id=2000000001),0,'but not one that runs from the name into the category');
-- The first tender is older than the window: only the second, with every bid kept, counts.
select is((select shared from public_procurement_cobidders(2000000001,(current_date - 60),50) where supplier_id=2000000002),1,'who bid in the same tenders');
select is((select their_wins from public_procurement_cobidders(2000000001,(current_date - 60),50) where supplier_id=2000000002),1,'and how often they won them');
select is((select wins from public_procurement_top_winners(array['%aseo plazas%'],'2024-01-01',50) where rut='2-7'),1,'who wins in the words');
select throws_ok($$insert into public_procurement_suppliers(rut,name) values('3.333.333-3','Mal escrito')$$,'23514',null,'a RUT is stored normalized');
select lives_ok($$insert into opportunity_jobs(organization_id,requested_by,kind,dedupe_key) values('b7000000-0000-4000-8000-000000000001','b6000000-0000-4000-8000-000000000001','contracts','contracts:test')$$,'«contracts» is a job kind');
select * from finish();
rollback;
