begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

insert into auth.users (id, email) values ('d7000000-0000-4000-8000-000000000001', 'pgtap-inbound@example.com');
insert into public.organizations (id, name) values ('d7100000-0000-4000-8000-000000000001', 'pgtap inbound');
insert into public.leads (id, user_id, organization_id, name, title, company, status)
values ('d7200000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001', 'd7100000-0000-4000-8000-000000000001',
        'Marcela Rojas', 'Gerente de RR. HH.', 'Servicios Norte', 'saved');

-- One contact is a saved lead. The other two are contacts of «Por escribir»: their lead_id is a uuid that is not in public.leads.
insert into public.contacted_leads (id, user_id, organization_id, lead_id, status, email, provider)
values
  ('pgtap-inbound-saved', 'd7000000-0000-4000-8000-000000000001', 'd7100000-0000-4000-8000-000000000001',
   'd7200000-0000-4000-8000-000000000001', 'sent', 'marcela@servicios-norte.test', 'gmail'),
  ('pgtap-inbound-unsaved', 'd7000000-0000-4000-8000-000000000001', 'd7100000-0000-4000-8000-000000000001',
   'd7300000-0000-4000-8000-000000000001', 'sent', 'pedro@servicios-norte.test', 'gmail'),
  ('pgtap-inbound-bounce', 'd7000000-0000-4000-8000-000000000001', 'd7100000-0000-4000-8000-000000000001',
   'd7300000-0000-4000-8000-000000000002', 'sent', 'nadie@servicios-norte.test', 'outlook');

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

-- A person who is not a saved lead declines: the reply is recorded and the contact is marked «do not contact».
select is(
  (public.ingest_inbound_reply_v1(
    'pgtap-inbound-unsaved', 'pedro@servicios-norte.test', 'gmail', 'pgtap-inbound-msg-1', null, 'reply', 'pgtap', now(),
    null, null, null, 'Re: Hola', 'No me interesa, gracias.', 'No me interesa, gracias.',
    '{"intent":"negative","sentiment":"negative","evaluationStatus":"do_not_contact","shouldContinue":false,"confidence":0.9}'::jsonb
  ) ->> 'inserted')::boolean,
  true,
  'a reply from a contact that is not a saved lead is recorded'
);

-- A saved lead answers: the response keeps its link to the lead.
select is(
  (public.ingest_inbound_reply_v1(
    'pgtap-inbound-saved', 'marcela@servicios-norte.test', 'gmail', 'pgtap-inbound-msg-2', null, 'reply', 'pgtap', now(),
    null, null, null, 'Re: Hola', 'Conversemos el jueves.', 'Conversemos el jueves.',
    '{"intent":"meeting_request","sentiment":"positive","evaluationStatus":"action_required","shouldContinue":false,"confidence":0.9}'::jsonb
  ) ->> 'inserted')::boolean,
  true,
  'a reply from a saved lead is recorded'
);

-- An address that bounces for good: the bounce is recorded and the contact is marked «do not contact».
select is(
  (public.ingest_inbound_reply_v1(
    'pgtap-inbound-bounce', 'nadie@servicios-norte.test', 'outlook', 'pgtap-inbound-msg-3', null, 'bounce', 'pgtap', now(),
    null, null, null, 'Undeliverable: Hola', 'The address does not exist.', 'The address does not exist.',
    '{"intent":"delivery_failure","sentiment":"neutral","evaluationStatus":"do_not_contact","shouldContinue":false,"confidence":0.9,"deliveryStatus":"bounced","bounceCategory":"hard","bounceReason":"mailbox_not_found"}'::jsonb
  ) ->> 'inserted')::boolean,
  true,
  'a hard bounce of a contact that is not a saved lead is recorded'
);

reset role;

select is(
  (select lead_id from public.lead_responses where contacted_id = 'pgtap-inbound-unsaved'),
  null::uuid,
  'the response of a contact that is not a saved lead carries no lead link'
);
select is(
  (select lead_id from public.lead_responses where contacted_id = 'pgtap-inbound-saved'),
  'd7200000-0000-4000-8000-000000000001'::uuid,
  'the response of a saved lead keeps its lead link'
);
select results_eq(
  $$select status, evaluation_status from public.contacted_leads where id = 'pgtap-inbound-unsaved'$$,
  $$values ('replied'::text, 'do_not_contact'::text)$$,
  'a declined contact is replied and do not contact'
);
select results_eq(
  $$select status, evaluation_status, type from public.contacted_leads cl
    join public.lead_responses lr on lr.contacted_id = cl.id where cl.id = 'pgtap-inbound-bounce'$$,
  $$values ('failed'::text, 'do_not_contact'::text, 'bounce'::text)$$,
  'a hard bounce is failed and do not contact'
);

-- The check still rejects a value nobody writes, and still admits the ones it had.
select throws_ok(
  $$update public.contacted_leads set evaluation_status = 'archived' where id = 'pgtap-inbound-saved'$$,
  '23514',
  null,
  'a status that is not written is rejected'
);
select lives_ok(
  $$update public.contacted_leads set evaluation_status = 'qualified' where id = 'pgtap-inbound-saved'$$,
  'the earlier statuses are still admitted'
);

select * from finish();
rollback;
