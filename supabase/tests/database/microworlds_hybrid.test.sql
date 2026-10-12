begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(25);
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.microworlds_search_jobs'::regclass,'public.microworlds_contact_cache'::regclass,'public.hybrid_enrichment_items'::regclass)), 'new private tables have RLS');
select ok(not has_table_privilege('authenticated','microworlds_contact_cache','select') and not has_table_privilege('anon','hybrid_enrichment_items','select'),'browser cannot read cached contacts/plans');
select ok(not has_function_privilege('authenticated','enqueue_microworlds_search_v1(uuid,uuid,text,text,jsonb)','execute')
  and has_function_privilege('service_role','enqueue_microworlds_search_v1(uuid,uuid,text,text,jsonb)','execute'),'worker RPC is service-only');
insert into auth.users(id,email) values('e9000000-0000-4000-8000-000000000001','hybrid-owner@antonia.test'),('e9000000-0000-4000-8000-000000000002','hybrid-outsider@antonia.test');
insert into organizations(id,name) values('e9100000-0000-4000-8000-000000000001','Hybrid QA');
insert into organization_members(organization_id,user_id,role) values('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','member');
select set_config('request.jwt.claim.role','service_role',true);
create temporary table hybrid_qa_values(k text primary key,v jsonb);
insert into hybrid_qa_values values('job',enqueue_microworlds_search_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001',repeat('a',64),'example.test','{"domain":"example.test"}'));
select is((select v->>'status' from hybrid_qa_values where k='job'),'queued','search enqueued');
select is(enqueue_microworlds_search_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001',repeat('a',64),'example.test','{"domain":"example.test"}')->>'reused','true','same criteria reuse one reservation');
select is((select reserved_micro_usd from microworlds_search_budgets where organization_id='e9100000-0000-4000-8000-000000000001'),1500000::bigint,'only USD1.50 reserved');
select throws_ok($$select enqueue_microworlds_search_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000002',repeat('b',64),'example.test','{}')$$,'22023',null,'outsider cannot reserve');
insert into hybrid_qa_values values('claim',claim_microworlds_search_v1((select (v->>'id')::uuid from hybrid_qa_values where k='job')));
select is((select v->>'status' from hybrid_qa_values where k='claim'),'submitting','durable start fence precedes provider POST');
select is(claim_microworlds_search_v1((select (v->>'id')::uuid from hybrid_qa_values where k='job')),null::jsonb,'second worker cannot start again');
update microworlds_search_jobs set lease_until=now()-interval '10 minutes' where id=(select (v->>'id')::uuid from hybrid_qa_values where k='job');
select maintain_microworlds_jobs_v1();
select is((select status from microworlds_search_jobs where id=(select (v->>'id')::uuid from hybrid_qa_values where k='job')),'unknown','expired start is unknown, not resubmitted');
select is((select reserved_micro_usd from microworlds_search_budgets where organization_id='e9100000-0000-4000-8000-000000000001'),1500000::bigint,'uncertain start retains its budget');
insert into hybrid_qa_values values('op',claim_antonia_quota_operation_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','user','investigate','hybrid-test-op',repeat('c',64),2,50,300));
select is((select v->>'claimed' from hybrid_qa_values where k='op'),'true','app reserves two logical contacts');
insert into enriched_leads(id,organization_id,user_id,source_provider,source_provider_id,full_name,enrichment_status,phone_numbers)
  values('hybrid-qa-target','e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','apollo','hybrid-person','Ana Pe***z','pending','[]');
select is(register_hybrid_enrichment_item_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','investigate','hybrid-test-op',
  (select (v->>'claim_token')::uuid from hybrid_qa_values where k='op'),'hybrid-qa-target','saved-ref','hybrid-person',true,true,'enc:v1.fixture'),true,'trusted target plan frozen');
insert into hybrid_qa_values values('callback',create_apollo_enrichment_callback_v1('e9000000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000001','investigate','enriched_leads','hybrid-qa-target',
  'hybrid-person',repeat('d',64),repeat('e',64),'hybrid-test-op',(select (v->>'claim_token')::uuid from hybrid_qa_values where k='op'),array['person.phone_numbers'],now()+interval '1 day'));
select is((select v->>'outcome' from hybrid_qa_values where k='callback'),'created','original callback boundary supports the same quota claim');
select mark_antonia_quota_operation_submitted_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','investigate','hybrid-test-op',(select (v->>'claim_token')::uuid from hybrid_qa_values where k='op'));
select is(apply_hybrid_cached_fields_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','investigate','hybrid-test-op',
  (select (v->>'claim_token')::uuid from hybrid_qa_values where k='op'),'hybrid-qa-target','{"email":"ana@example.test","emailStatus":"unknown","fullName":"Ana Pérez"}')->>'outcome','processed','cache email applied');
select is((select email from enriched_leads where id='hybrid-qa-target'),'ana@example.test','cached email persisted');
select is((select email_status from enriched_leads where id='hybrid-qa-target'),'unknown','cache without status is not called verified');
select is(apply_hybrid_cached_fields_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','investigate','hybrid-test-op',
  (select (v->>'claim_token')::uuid from hybrid_qa_values where k='op'),'hybrid-qa-target','{"email":"other@example.test"}')->>'outcome','replay','cache not reapplied');
select is(settle_hybrid_enrichment_operation_v1('e9100000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000001','investigate','hybrid-test-op'),false,'pending Apollo callback delays settlement');
select mark_apollo_enrichment_callback_submitted_v1((select (v->>'callbackId')::uuid from hybrid_qa_values where k='callback'),repeat('d',64),(select (v->>'claim_token')::uuid from hybrid_qa_values where k='op'));
update enriched_leads set primary_phone='+15550100123',phone_numbers='[{"sanitized_number":"+15550100123"}]' where id='hybrid-qa-target';
select is(apply_apollo_enrichment_callback_v1(repeat('d',64),'hybrid-provider-request','SUCCEEDED',repeat('f',64),
  '{"apollo_person_id":"hybrid-person","primary_phone":"+56912345678","phone_numbers":[{"sanitized_number":"+56912345678"}]}' )->>'outcome','processed','real callback settles through hybrid accounting');
select is((select primary_phone from enriched_leads where id='hybrid-qa-target'),'+15550100123','late callback preserves concurrent edited phone');
select is((select consumed_count from antonia_quota_operations where operation_id='hybrid-test-op'),1,'cache plus Apollo on same target is one credit; unprocessed contact refunded');
select is((select status from antonia_quota_operations where operation_id='hybrid-test-op'),'completed','same operation completed');
select is(apply_apollo_enrichment_callback_v1(repeat('d',64),'hybrid-provider-request','SUCCEEDED',repeat('0',64),
  '{"apollo_person_id":"hybrid-person","primary_phone":"+56900000000","phone_numbers":[{"sanitized_number":"+56900000000"}]}' )->>'outcome','duplicate','repeated delivery is not a new effect');
select is((select consumed_count from antonia_quota_operations where operation_id='hybrid-test-op'),1,'delivery replay does not bill again');
select * from finish();
rollback;
