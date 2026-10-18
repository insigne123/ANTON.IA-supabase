begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(7);
insert into auth.users(id,email) values ('b6000000-0000-4000-8000-000000000001','docs-admin@antonia.test');
insert into organizations(id,name) values('b7000000-0000-4000-8000-000000000001','Company documents test');
select ok((select relrowsecurity from pg_class where relname='opportunity_company_documents'),'documents have RLS');
select ok(not has_table_privilege('authenticated','opportunity_company_documents','select'),'no direct browser read');
select lives_ok($$insert into opportunity_company_documents(organization_id,kind,label,file_name,storage_path,mime,size_bytes,expires_at,uploaded_by)
  values('b7000000-0000-4000-8000-000000000001','f30','Certificado F30','F30.pdf','company/b7000000-0000-4000-8000-000000000001/a-F30.pdf','application/pdf',1200,'2026-10-31','b6000000-0000-4000-8000-000000000001')$$,'a document is saved');
select throws_ok($$insert into opportunity_company_documents(organization_id,kind,label,file_name,storage_path,mime,size_bytes)
  values('b7000000-0000-4000-8000-000000000001','pasaporte','Otro','x.pdf','company/b7000000-0000-4000-8000-000000000001/b-x.pdf','application/pdf',10)$$,'23514',null,'only known kinds');
select throws_ok($$insert into opportunity_company_documents(organization_id,kind,label,file_name,storage_path,mime,size_bytes)
  values('b7000000-0000-4000-8000-000000000001','otro','Fuera','x.pdf','public-data/x.pdf','application/pdf',10)$$,'23514',null,'files live under company/');
select throws_ok($$insert into opportunity_company_documents(organization_id,kind,label,file_name,storage_path,mime,size_bytes)
  values('b7000000-0000-4000-8000-000000000001','otro','Grande','x.pdf','company/b7000000-0000-4000-8000-000000000001/c-x.pdf','application/pdf',30000000)$$,'23514',null,'up to 20 MB');
select is((select confdeltype::text from pg_constraint where conname='opportunity_company_documents_organization_id_fkey'),'c','documents leave with their workspace');
select * from finish();
rollback;
