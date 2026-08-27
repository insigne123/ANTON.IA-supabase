begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(27);

select has_table(
  'public',
  'fullenrich_enrichment_callbacks',
  'FullEnrich callback persistence exists after a clean migration replay'
);
select has_column(
  'public',
  'fullenrich_enrichment_callbacks',
  'callback_id',
  'callbacks expose the opaque callback identifier'
);
select has_column(
  'public',
  'fullenrich_enrichment_callbacks',
  'provider_enrichment_id',
  'callbacks retain the FullEnrich enrichment ID'
);
select has_column(
  'public',
  'fullenrich_enrichment_callbacks',
  'quota_resource',
  'callbacks retain the quota resource needed for asynchronous completion'
);
select has_column(
  'public',
  'fullenrich_enrichment_callbacks',
  'requested_fields',
  'callbacks retain the requested field scope'
);
select has_column(
  'public',
  'fullenrich_enrichment_callbacks',
  'terminal_state',
  'callbacks retain their terminal state'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.fullenrich_enrichment_callbacks'::regclass),
  true,
  'callback persistence has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.fullenrich_enrichment_callbacks', 'select')
    and not has_table_privilege('authenticated', 'public.fullenrich_enrichment_callbacks', 'insert')
    and not has_table_privilege('authenticated', 'public.fullenrich_enrichment_callbacks', 'update'),
  'authenticated users have no callback table privileges'
);
select ok(
  has_table_privilege('service_role', 'public.fullenrich_enrichment_callbacks', 'select')
    and has_table_privilege('service_role', 'public.fullenrich_enrichment_callbacks', 'insert')
    and has_table_privilege('service_role', 'public.fullenrich_enrichment_callbacks', 'update'),
  'service role retains callback table privileges'
);
select ok(
  to_regprocedure('public.apply_fullenrich_enrichment_callback_v1(uuid,text,text,text,jsonb)') is not null,
  'the atomic FullEnrich callback application RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_fullenrich_enrichment_callback_v1(uuid,text,text,text,jsonb)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.apply_fullenrich_enrichment_callback_v1(uuid,text,text,text,jsonb)',
    'execute'
  ),
  'the callback application RPC is service-role-only'
);
select ok(
  to_regclass('public.fullenrich_enrichment_callbacks_operation_target_key') is not null,
  'callbacks are unique per operation and target'
);
select ok(
  to_regclass('public.fullenrich_enrichment_callbacks_active_target_key') is not null,
  'a target cannot have two active FullEnrich callbacks'
);

insert into auth.users (id, email)
values ('c0000000-0000-4000-8000-000000000001', 'fullenrich-callback-owner@antonia.test');

insert into public.organizations (id, name)
values ('c1000000-0000-4000-8000-000000000001', 'FullEnrich Callback Test');

insert into public.enriched_leads (
  id, user_id, organization_id, full_name, enrichment_status
) values (
  'fullenrich-target-lead',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'FullEnrich Target',
  'pending_phone'
);

insert into public.enriched_opportunities (
  id, user_id, organization_id, full_name, enrichment_status
) values (
  'c3000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'FullEnrich Opportunity Target',
  'pending_phone'
);

insert into public.people_search_leads (
  id, user_id, organization_id, name, enrichment_status
) values (
  'fullenrich-person-target',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'FullEnrich People Search Target',
  'pending_phone'
);

insert into public.fullenrich_enrichment_callbacks (
  callback_id, provider_enrichment_id, operation_id, user_id, organization_id,
  target_table, target_id, requested_fields
) values (
  'c2000000-0000-4000-8000-000000000001',
  'fullenrich-batch-1',
  'fullenrich-operation-1',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'enriched_leads',
  'fullenrich-target-lead',
  array['contact.work_emails', 'contact.phones']
), (
  'c2000000-0000-4000-8000-000000000002',
  'fullenrich-batch-1',
  'fullenrich-operation-2',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'enriched_leads',
  'missing-target',
  array['contact.work_emails']
), (
  'c2000000-0000-4000-8000-000000000003',
  'fullenrich-batch-1',
  'fullenrich-operation-3',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'enriched_opportunities',
  'c3000000-0000-4000-8000-000000000001',
  array['contact.work_emails']
), (
  'c2000000-0000-4000-8000-000000000004',
  'fullenrich-batch-1',
  'fullenrich-operation-4',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'people_search_leads',
  'fullenrich-person-target',
  array['contact.phones']
), (
  'c2000000-0000-4000-8000-000000000005',
  null,
  'fullenrich-operation-5',
  'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'enriched_leads',
  'fullenrich-bound-target',
  array['contact.work_emails']
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select is(
  public.bind_fullenrich_enrichment_callbacks_v1(
    array['c2000000-0000-4000-8000-000000000005'::uuid],
    'fullenrich-batch-bound'
  ) ->> 'outcome',
  'bound',
  'callbacks can be bound to the provider enrichment ID after submission'
);
select is(
  (
    select provider_enrichment_id
    from public.fullenrich_enrichment_callbacks
    where callback_id = 'c2000000-0000-4000-8000-000000000005'
  ),
  'fullenrich-batch-bound',
  'the bound provider enrichment ID is durable'
);
select is(
  public.bind_fullenrich_enrichment_callbacks_v1(
    array['c2000000-0000-4000-8000-000000000005'::uuid],
    'fullenrich-batch-other'
  ) ->> 'outcome',
  'provider_enrichment_mismatch',
  'a bound callback refuses reassignment to another provider batch'
);

select is(
  public.apply_fullenrich_enrichment_callback_v1(
    'c2000000-0000-4000-8000-000000000001',
    'fullenrich-batch-1',
    'IN_PROGRESS',
    repeat('a', 64),
    jsonb_build_object(
      'work_email', jsonb_build_object('email', 'enriched@example.test', 'status', 'DELIVERABLE'),
      'phone_numbers', jsonb_build_array(jsonb_build_object(
        'raw_number', '+15550100001',
        'sanitized_number', '+15550100001',
        'type', 'mobile',
        'position', 'current',
        'status', 'verified',
        'region', 'US'
      )),
      'primary_phone', '+15550100001'
    )
  ) ->> 'outcome',
  'processed',
  'the callback writes its persisted target once'
);
select results_eq(
  $$select email, primary_phone, enrichment_status
    from public.enriched_leads where id = 'fullenrich-target-lead'$$,
  $$values ('enriched@example.test'::text, '+15550100001'::text, 'completed'::text)$$,
  'the target receives only the callback enrichment data'
);
select results_eq(
  $$select status, terminal_state, delivery_count, last_error_code
    from public.fullenrich_enrichment_callbacks
    where callback_id = 'c2000000-0000-4000-8000-000000000001'$$,
  $$values ('terminal'::text, 'succeeded'::text, 1::integer, null::text)$$,
  'successful callback state is terminal and durable'
);
select is(
  public.apply_fullenrich_enrichment_callback_v1(
    'c2000000-0000-4000-8000-000000000001',
    'fullenrich-batch-1',
    'IN_PROGRESS',
    repeat('b', 64),
    jsonb_build_object('work_email', jsonb_build_object('email', 'different@example.test'))
  ) ->> 'outcome',
  'duplicate',
  'duplicate callbacks are recognized before the target is written again'
);
select results_eq(
  $$select email, delivery_count from public.enriched_leads lead
    join public.fullenrich_enrichment_callbacks callback
      on callback.target_id = lead.id
    where callback.callback_id = 'c2000000-0000-4000-8000-000000000001'$$,
  $$values ('enriched@example.test'::text, 2::integer)$$,
  'a duplicate records delivery metadata but preserves the first target update'
);
select is(
  public.apply_fullenrich_enrichment_callback_v1(
    'c2000000-0000-4000-8000-000000000002',
    'fullenrich-batch-1',
    'FINISHED',
    repeat('c', 64),
    jsonb_build_object('work_email', jsonb_build_object('email', 'missing@example.test'))
  ) ->> 'outcome',
  'target_not_found',
  'a missing or ownership-mismatched target fails closed'
);
select results_eq(
  $$select status, terminal_state, last_error_code
    from public.fullenrich_enrichment_callbacks
    where callback_id = 'c2000000-0000-4000-8000-000000000002'$$,
  $$values ('terminal'::text, 'failed'::text, 'target_not_found'::text)$$,
  'a missing target leaves an auditable terminal callback state'
);
select is(
  public.apply_fullenrich_enrichment_callback_v1(
    'c2000000-0000-4000-8000-000000000003',
    'fullenrich-batch-1',
    'FINISHED',
    repeat('d', 64),
    jsonb_build_object('work_email', jsonb_build_object('email', 'opportunity@example.test', 'status', 'DELIVERABLE'))
  ) ->> 'outcome',
  'processed',
  'an opportunity callback is applied through the same locked boundary'
);
select results_eq(
  $$select email, email_status, enrichment_status
    from public.enriched_opportunities
    where id = 'c3000000-0000-4000-8000-000000000001'$$,
  $$values ('opportunity@example.test'::text, 'DELIVERABLE'::text, 'completed'::text)$$,
  'the opportunity target is selected from the callback record'
);
select is(
  public.apply_fullenrich_enrichment_callback_v1(
    'c2000000-0000-4000-8000-000000000004',
    'fullenrich-batch-1',
    'FINISHED',
    repeat('e', 64),
    jsonb_build_object(
      'work_email', jsonb_build_object('email', 'not-requested@example.test', 'status', 'DELIVERABLE'),
      'phone_numbers', jsonb_build_array(jsonb_build_object(
        'raw_number', '+15550100002',
        'sanitized_number', '+15550100002',
        'type', 'mobile',
        'position', 'current',
        'status', 'verified'
      )),
      'primary_phone', '+15550100002'
    )
  ) ->> 'outcome',
  'processed',
  'a people-search callback applies only requested contact fields'
);
select results_eq(
  $$select email, primary_phone, enrichment_status
    from public.people_search_leads
    where id = 'fullenrich-person-target'$$,
  $$values (null::text, '+15550100002'::text, 'completed'::text)$$,
  'unrequested email data is not written to the people-search target'
);

reset role;
select * from finish();
rollback;
