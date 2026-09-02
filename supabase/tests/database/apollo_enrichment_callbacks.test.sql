begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(69);

select has_table('public', 'apollo_enrichment_callbacks', 'Apollo callback persistence exists');
select has_column('public', 'apollo_enrichment_callbacks', 'token_hash', 'callbacks persist only the token hash');
select has_column('public', 'apollo_enrichment_callbacks', 'terminal_state', 'callbacks expose terminal state');
select has_column('public', 'apollo_enrichment_callbacks', 'provider_request_id', 'callbacks retain provider request IDs as text');
select has_column('public', 'apollo_enrichment_callbacks', 'reconciliation_not_before', 'callbacks retain provider retry cooldown');
select has_table('public', 'apollo_contact_subject_refs', 'suppressed Apollo contacts retain a private erasure reference');
select has_table('public', 'apollo_organization_contexts', 'Apollo organization context persistence exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.apollo_organization_contexts'::regclass),
  true,
  'Apollo organization contexts have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.apollo_organization_contexts', 'select')
    and has_table_privilege('service_role', 'public.apollo_organization_contexts', 'select'),
  'Apollo organization contexts are service-role-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_apollo_organization_enrichment_v1(uuid,uuid,text,uuid,text,text,jsonb,timestamp with time zone,jsonb)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.complete_apollo_organization_enrichment_v1(uuid,uuid,text,uuid,text,text,jsonb,timestamp with time zone,jsonb)',
    'execute'
  ),
  'Apollo organization context completion is service-role-only'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.apollo_enrichment_callbacks'::regclass),
  true,
  'Apollo callbacks have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.apollo_enrichment_callbacks', 'select')
    and not has_table_privilege('authenticated', 'public.apollo_enrichment_callbacks', 'insert')
    and not has_table_privilege('authenticated', 'public.apollo_enrichment_callbacks', 'update'),
  'authenticated users have no Apollo callback privileges'
);
select ok(
  has_table_privilege('service_role', 'public.apollo_enrichment_callbacks', 'select')
    and has_table_privilege('service_role', 'public.apollo_enrichment_callbacks', 'insert')
    and has_table_privilege('service_role', 'public.apollo_enrichment_callbacks', 'update'),
  'service role retains Apollo callback privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.apollo_contact_subject_refs', 'select')
    and has_table_privilege('service_role', 'public.apollo_contact_subject_refs', 'select'),
  'Apollo privacy subject references are service-role-only'
);
select ok(
  to_regprocedure('public.apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb)') is not null,
  'the atomic Apollo callback RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.apply_apollo_enrichment_callback_v1(text,text,text,text,jsonb)',
    'execute'
  ),
  'the Apollo callback RPC is service-role-only'
);
select ok(
  to_regprocedure('public.claim_apollo_enrichment_reconciliation_candidates_v1(integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)') is not null,
  'the reconciliation claim RPC exists'
);
select ok(
  to_regprocedure('public.mark_apollo_match_operation_submitted_v1(uuid,uuid,text,text,uuid,text,text)') is not null,
  'the atomic Apollo match-only boundary RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mark_apollo_match_operation_submitted_v1(uuid,uuid,text,text,uuid,text,text)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.mark_apollo_match_operation_submitted_v1(uuid,uuid,text,text,uuid,text,text)',
    'execute'
  ),
  'the Apollo match-only boundary RPC is service-role-only'
);
select ok(
  to_regprocedure('public.has_apollo_enrichment_email_suppression_v1(uuid,uuid,text[])') is not null,
  'the normalized Apollo suppression lookup RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.has_apollo_enrichment_email_suppression_v1(uuid,uuid,text[])',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.has_apollo_enrichment_email_suppression_v1(uuid,uuid,text[])',
    'execute'
  ),
  'the normalized Apollo suppression lookup is service-role-only'
);
select ok(
  to_regclass('public.apollo_enrichment_callbacks_active_target_key') is not null,
  'a target cannot have multiple active Apollo callbacks'
);

insert into auth.users (id, email)
values
  ('d0000000-0000-4000-8000-000000000001', 'apollo-callback-owner@antonia.test'),
  ('d0000000-0000-4000-8000-000000000002', 'apollo-callback-outsider@antonia.test');

insert into public.organizations (id, name)
values
  ('d1000000-0000-4000-8000-000000000001', 'Apollo Callback Primary'),
  ('d1000000-0000-4000-8000-000000000002', 'Apollo Callback Outsider');

insert into public.unsubscribed_emails (email, reason)
values
  ('suppressed-apollo@example.test', 'pgtap'),
  ('  MIXED-CASE-APOLLO@EXAMPLE.TEST  ', 'pgtap');

insert into public.unsubscribed_emails (email, organization_id, reason)
values (
  'other-tenant-apollo@example.test',
  'd1000000-0000-4000-8000-000000000002',
  'pgtap'
);

insert into public.people_search_leads (
  id, user_id, organization_id, email, primary_phone, enrichment_status
) values (
  'suppressed-apollo-target',
  'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'suppressed-apollo@example.test',
  '+15550100099',
  'completed'
);

select results_eq(
  $$select email, primary_phone, enrichment_status
    from public.people_search_leads where id = 'suppressed-apollo-target'$$,
  $$values (null::text, null::text, 'suppressed'::text)$$,
  'suppressed Apollo contact data is rejected atomically on write'
);
select ok(
  exists (
    select 1
    from public.apollo_contact_subject_refs ref
    where ref.target_table = 'people_search_leads'
      and ref.target_lead_id = 'suppressed-apollo-target'
  ),
  'suppressed inserts retain a private subject reference for later erasure'
);

update public.people_search_leads
set primary_phone = '+15550100999', enrichment_status = 'completed'
where id = 'suppressed-apollo-target';
select results_eq(
  $$select primary_phone, enrichment_status
    from public.people_search_leads where id = 'suppressed-apollo-target'$$,
  $$values (null::text, 'suppressed'::text)$$,
  'a phone-only callback cannot reactivate a suppressed Apollo target'
);

update public.people_search_leads
set name = 'Reintroduced Person'
where id = 'suppressed-apollo-target';
select results_eq(
  $$select name, enrichment_status
    from public.people_search_leads where id = 'suppressed-apollo-target'$$,
  $$values (null::text, 'suppressed'::text)$$,
  'identity-only updates cannot reintroduce data into a suppressed target'
);

insert into public.people_search_leads (
  id, user_id, organization_id, name, enrichment_status
) values (
  'apollo-null-email-target',
  'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Pending Apollo Person',
  'pending'
);
update public.people_search_leads
set email = 'suppressed-apollo@example.test',
    name = 'Provider Apollo Person',
    source_provider_id = 'provider-apollo-person',
    enrichment_status = 'completed'
where id = 'apollo-null-email-target';
select ok(
  exists (
    select 1
    from public.apollo_contact_subject_refs ref
    where ref.target_table = 'people_search_leads'
      and ref.target_lead_id = 'apollo-null-email-target'
      and ref.email_hash = encode(digest('suppressed-apollo@example.test', 'sha256'), 'hex')
  ) and exists (
    select 1
    from public.people_search_leads target
    where target.id = 'apollo-null-email-target'
      and target.email is null
      and target.name = 'Pending Apollo Person'
      and target.source_provider_id is null
      and target.enrichment_status = 'suppressed'
  ),
  'a suppressed synchronous result remains erasable without persisting provider identity'
);

insert into public.people_search_leads (
  id, user_id, organization_id, name, title, email, source_provider,
  source_provider_id, enrichment_status
) values (
  'apollo-suppressed-update-target',
  'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Original Person',
  'Original Title',
  'original-apollo@example.test',
  'apollo',
  'original-apollo-person',
  'completed'
);

update public.people_search_leads
set email = 'suppressed-apollo@example.test',
    name = 'Suppressed Replacement',
    title = 'Replacement Title',
    source_provider_id = 'suppressed-apollo-person'
where id = 'apollo-suppressed-update-target';

select results_eq(
  $$select name, title, email, source_provider_id, enrichment_status
    from public.people_search_leads where id = 'apollo-suppressed-update-target'$$,
  $$values (
    'Original Person'::text,
    'Original Title'::text,
    'original-apollo@example.test'::text,
    'original-apollo-person'::text,
    'suppressed'::text
  )$$,
  'a suppressed replacement cannot mix its identity with the existing target'
);
select ok(
  exists (
    select 1
    from public.apollo_contact_subject_refs ref
    where ref.target_table = 'people_search_leads'
      and ref.target_lead_id = 'apollo-suppressed-update-target'
      and ref.email_hash = encode(digest('original-apollo@example.test', 'sha256'), 'hex')
  ) and not exists (
    select 1
    from public.apollo_contact_subject_refs ref
    where ref.target_table = 'people_search_leads'
      and ref.target_lead_id = 'apollo-suppressed-update-target'
      and ref.email_hash = encode(digest('suppressed-apollo@example.test', 'sha256'), 'hex')
  ),
  'a rejected suppressed replacement keeps only the original privacy subject reference'
);

insert into public.enriched_leads (id, user_id, organization_id, full_name, enrichment_status)
values (
  'apollo-callback-target',
  'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'Apollo Callback Target',
  'pending_phone'
);

insert into public.enriched_leads (id, user_id, organization_id, full_name, enrichment_status)
values
  (
    'apollo-match-target',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Apollo Match Target',
    'pending'
  ),
  (
    'apollo-email-only-target',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Apollo Email Target',
    'pending'
  ),
  (
    'apollo-partial-target-1',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Apollo Partial Target One',
    'pending_phone'
  ),
  (
    'apollo-partial-target-2',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Apollo Partial Target Two',
    'pending_phone'
  ),
  (
    'apollo-user-partial-target-1',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Apollo User Partial Target One',
    'pending_phone'
  ),
  (
    'apollo-user-partial-target-2',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Apollo User Partial Target Two',
    'pending_phone'
  );

insert into public.antonia_quota_operations (
  organization_id, user_id, resource, operation_id, request_fingerprint,
  requested_count, quota_scope, quota_day, quota_allowed, quota_count_after,
  quota_limit, consumed_count, status, claim_token, claimed_at
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'investigate',
  'apollo-operation-1',
  repeat('f', 64),
  1,
  'organization',
  timezone('utc', now())::date,
  true,
  1,
  100,
  1,
  'claimed',
  'd2000000-0000-4000-8000-000000000001',
  now()
);

insert into public.antonia_quota_operations (
  organization_id, user_id, resource, operation_id, request_fingerprint,
  requested_count, quota_scope, quota_day, quota_allowed, quota_count_after,
  quota_limit, consumed_count, status, claim_token, claimed_at
) values
  (
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'investigate', 'apollo-match-operation', repeat('1', 64), 2, 'organization',
    timezone('utc', now())::date, true, 2, 100, 2, 'claimed',
    'd2000000-0000-4000-8000-000000000002', now()
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'investigate', 'apollo-email-operation', repeat('2', 64), 1, 'organization',
    timezone('utc', now())::date, true, 1, 100, 1, 'claimed',
    'd2000000-0000-4000-8000-000000000003', now()
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'investigate', 'apollo-partial-operation', repeat('3', 64), 2, 'organization',
    timezone('utc', now())::date, true, 2, 100, 2, 'claimed',
    'd2000000-0000-4000-8000-000000000004', now()
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'investigate', 'apollo-user-partial-operation', repeat('5', 64), 2, 'user',
    timezone('utc', now())::date, true, 2, 100, 2, 'submitted',
    'd2000000-0000-4000-8000-000000000005', now()
  );

update public.antonia_quota_operations
set submitted_at = now()
where operation_id = 'apollo-user-partial-operation';

insert into public.antonia_daily_usage (organization_id, date, leads_investigated)
values (
  'd1000000-0000-4000-8000-000000000001',
  timezone('utc', now())::date,
  2
);

insert into public.antonia_user_daily_usage (
  organization_id, user_id, date, resource, usage_count
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  timezone('utc', now())::date,
  'investigate',
  2
);

insert into public.apollo_enrichment_callbacks (
  user_id, organization_id, target_table, target_lead_id, apollo_person_id,
  token_hash, idempotency_key, operation_id, quota_resource, requested_fields,
  reveal_email, reveal_phone, status, terminal_state, terminal_at, expires_at,
  provider_queued_at
) values
  (
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'enriched_leads', 'apollo-user-partial-target-1', 'apollo-user-partial-person-1',
    repeat('0', 64), 'apollo-user-partial-callback-1', 'apollo-user-partial-operation',
    'investigate', array['person.phone_numbers'], false, true, 'terminal',
    'succeeded', now(), now() + interval '1 day', now()
  ),
  (
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'enriched_leads', 'apollo-user-partial-target-2', 'apollo-user-partial-person-2',
    repeat('d', 64), 'apollo-user-partial-callback-2', 'apollo-user-partial-operation',
    'investigate', array['person.phone_numbers'], false, true, 'processing',
    null, null, now() + interval '1 day', null
  );

insert into public.antonia_quota_operations (
  organization_id, user_id, resource, operation_id, request_fingerprint,
  requested_count, quota_scope, quota_day, quota_allowed, quota_count_after,
  quota_limit, consumed_count, status, completed_at, response_status, response_payload
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'enrich',
  'apollo-historical-replay-operation',
  repeat('4', 64),
  2,
  'organization',
  timezone('utc', now())::date,
  true,
  2,
  100,
  2,
  'completed',
  now(),
  200,
  jsonb_build_object('enriched', jsonb_build_array(
    jsonb_build_object(
      'id', 'historical-suppressed',
      'email', 'suppressed-apollo@example.test',
      'primaryPhone', '+15550100003',
      'enrichmentStatus', 'completed'
    ),
    jsonb_build_object(
      'id', 'historical-unrelated',
      'email', 'unrelated-apollo@example.test',
      'primaryPhone', '+15550100004',
      'enrichmentStatus', 'completed'
    )
  ))
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select is(
  public.has_apollo_enrichment_email_suppression_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    array['mixed-case-apollo@example.test']
  ),
  true,
  'the pre-provider suppression lookup normalizes stored casing and whitespace'
);
select is(
  public.has_apollo_enrichment_email_suppression_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    array['other-tenant-apollo@example.test']
  ),
  false,
  'the pre-provider suppression lookup does not leak another tenant scope'
);

select is(
  public.mark_apollo_match_operation_submitted_v1(
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'investigate',
    'apollo-match-operation',
    'd2000000-0000-4000-8000-000000000002',
    'enriched_leads',
    'apollo-match-target'
  ) ->> 'outcome',
  'submitted',
  'match-only atomically locks the target before crossing the provider boundary'
);
select is(
  public.mark_apollo_match_operation_submitted_v1(
    'd1000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'investigate',
    'apollo-match-operation',
    'd2000000-0000-4000-8000-000000000002',
    'people_search_leads',
    'suppressed-apollo-target'
  ) ->> 'outcome',
  'target_suppressed',
  'every match-only batch target is revalidated after the first provider submission'
);

select is(
  public.create_apollo_enrichment_callback_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'investigate',
    'enriched_leads',
    'apollo-callback-target',
    'apollo-person-1',
    repeat('8', 64),
    repeat('7', 64),
    'apollo-operation-1',
    'd2000000-0000-4000-8000-000000000099',
    array['person.email'],
    now() + interval '1 day'
  ) ->> 'outcome',
  'quota_claim_not_owned',
  'a stale worker cannot create a callback without the current quota claim'
);

select is(
  public.create_apollo_enrichment_callback_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'investigate',
    'enriched_leads',
    'apollo-callback-target',
    'apollo-person-1',
    repeat('a', 64),
    repeat('b', 64),
    'apollo-operation-1',
    'd2000000-0000-4000-8000-000000000001',
    array['person.email', 'person.phone_numbers'],
    now() + interval '1 day'
  ) ->> 'outcome',
  'created',
  'a tenant-scoped callback is created for a claimed quota operation'
);

select is(
  public.create_apollo_enrichment_callback_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    'investigate',
    'enriched_leads',
    'apollo-callback-target',
    'apollo-person-1',
    repeat('c', 64),
    repeat('d', 64),
    'apollo-operation-1',
    'd2000000-0000-4000-8000-000000000001',
    array['person.phone_numbers'],
    now() + interval '1 day'
  ) ->> 'outcome',
  'quota_claim_not_owned',
  'a callback cannot cross the persisted quota tenant'
);

select is(
  public.replace_unsubmitted_apollo_callback_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('a', 64)),
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'apollo-operation-1',
    'd2000000-0000-4000-8000-000000000001',
    repeat('9', 64),
    now() + interval '1 day'
  ) ->> 'outcome',
  'replaced',
  'an unsubmitted callback rotates its token under the currently owned quota claim'
);

select is(
  public.mark_apollo_enrichment_callback_submitted_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('9', 64)),
    repeat('9', 64),
    'd2000000-0000-4000-8000-000000000001'
  ) ->> 'outcome',
  'submitted',
  'the callback crosses the provider boundary once'
);
select is(
  public.mark_apollo_enrichment_callback_submitted_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('9', 64)),
    repeat('9', 64),
    'd2000000-0000-4000-8000-000000000001'
  ) ->> 'outcome',
  'provider_outcome_unknown',
  'a retry cannot submit the chargeable provider request again'
);
select is(
  (select status from public.antonia_quota_operations where operation_id = 'apollo-operation-1'),
  'submitted',
  'callback submission atomically moves the quota operation to submitted'
);
select is(
  public.bind_apollo_enrichment_callback_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('9', 64)),
    '-9223372036854775807',
    'apollo-person-1'
  ) ->> 'outcome',
  'bound',
  'the signed provider request ID is bound as text'
);
select is(
  public.apply_apollo_enrichment_callback_v1(
    repeat('9', 64),
    '-9223372036854775807',
    'SUCCEEDED',
    repeat('e', 64),
    jsonb_build_object(
      'apollo_person_id', 'apollo-person-1',
      'email', 'apollo-enriched@example.test',
      'email_status', 'verified',
      'phone_numbers', jsonb_build_array(jsonb_build_object(
        'raw_number', '+15550100001',
        'sanitized_number', '+15550100001',
        'type', 'mobile',
        'position', 'current',
        'status', 'verified'
      )),
      'primary_phone', '+15550100001'
    )
  ) ->> 'outcome',
  'processed',
  'the first provider delivery is applied atomically'
);
select results_eq(
  $$select email, primary_phone, source_provider, source_provider_id, enrichment_status
    from public.enriched_leads where id = 'apollo-callback-target'$$,
  $$values (
    'apollo-enriched@example.test'::text,
    '+15550100001'::text,
    'apollo'::text,
    'apollo-person-1'::text,
    'completed'::text
  )$$,
  'the persisted target receives only the requested Apollo contact fields'
);
select results_eq(
  $$select status, terminal_state, provider_request_id, delivery_count
    from public.apollo_enrichment_callbacks where token_hash = repeat('9', 64)$$,
  $$values ('terminal'::text, 'succeeded'::text, '-9223372036854775807'::text, 1::integer)$$,
  'the callback reaches a durable terminal state'
);
select results_eq(
  $$select status, response_status, response_payload ->> 'provider'
    from public.antonia_quota_operations where operation_id = 'apollo-operation-1'$$,
  $$values ('completed'::text, 202::integer, 'apollo'::text)$$,
  'the final callback settles the quota operation'
);
select is(
  public.apply_apollo_enrichment_callback_v1(
    repeat('9', 64),
    '-9223372036854775807',
    'SUCCEEDED',
    repeat('1', 64),
    jsonb_build_object('email', 'different@example.test')
  ) ->> 'outcome',
  'duplicate',
  'duplicate deliveries are acknowledged without rewriting the target'
);
select results_eq(
  $$select email, delivery_count from public.enriched_leads target
    join public.apollo_enrichment_callbacks callback
      on callback.target_lead_id = target.id
    where callback.token_hash = repeat('9', 64)$$,
  $$values ('apollo-enriched@example.test'::text, 2::integer)$$,
  'duplicate delivery metadata is counted while first-write contact data remains'
);

select is(
  public.create_apollo_enrichment_callback_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'investigate',
    'enriched_leads',
    'apollo-email-only-target',
    'apollo-email-person',
    repeat('2', 64),
    repeat('3', 64),
    'apollo-email-operation',
    'd2000000-0000-4000-8000-000000000003',
    array['person.email'],
    now() + interval '1 day'
  ) ->> 'outcome',
  'created',
  'email-only enrichment creates a durable callback before submission'
);
select is(
  public.mark_apollo_enrichment_callback_submitted_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('2', 64)),
    repeat('2', 64),
    'd2000000-0000-4000-8000-000000000003'
  ) ->> 'outcome',
  'submitted',
  'email-only enrichment persists its provider boundary'
);
select is(
  public.bind_apollo_enrichment_callback_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('2', 64)),
    'apollo-email-request',
    'apollo-email-person'
  ) ->> 'outcome',
  'bound',
  'email-only enrichment binds its provider request'
);
select is(
  public.apply_apollo_enrichment_callback_v1(
    repeat('2', 64),
    'apollo-email-request',
    'SUCCEEDED',
    repeat('4', 64),
    jsonb_build_object(
      'apollo_person_id', 'apollo-email-person',
      'email', 'apollo-email-only@example.test',
      'email_status', 'verified'
    )
  ) ->> 'outcome',
  'processed',
  'an email-only Apollo result is applied atomically'
);
select results_eq(
  $$select status, response_status, consumed_count
    from public.antonia_quota_operations where operation_id = 'apollo-email-operation'$$,
  $$values ('completed'::text, 200::integer, 1::integer)$$,
  'an email-only callback completes its quota operation synchronously'
);

select is(
  public.create_apollo_enrichment_callback_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'investigate',
    'enriched_leads',
    'apollo-partial-target-1',
    'apollo-partial-person-1',
    repeat('5', 64),
    repeat('6', 64),
    'apollo-partial-operation',
    'd2000000-0000-4000-8000-000000000004',
    array['person.phone_numbers'],
    now() + interval '1 day'
  ) ->> 'outcome',
  'created',
  'the submitted target in a partial batch has a durable callback'
);
select is(
  public.create_apollo_enrichment_callback_v1(
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'investigate',
    'enriched_leads',
    'apollo-partial-target-2',
    'apollo-partial-person-2',
    repeat('7', 64),
    repeat('8', 64),
    'apollo-partial-operation',
    'd2000000-0000-4000-8000-000000000004',
    array['person.phone_numbers'],
    now() + interval '1 day'
  ) ->> 'outcome',
  'created',
  'the unsubmitted target in a partial batch has a durable callback'
);
select is(
  public.mark_apollo_enrichment_callback_submitted_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('5', 64)),
    repeat('5', 64),
    'd2000000-0000-4000-8000-000000000004'
  ) ->> 'outcome',
  'submitted',
  'only the provider-bound partial-batch callback is charged'
);
select is(
  public.bind_apollo_enrichment_callback_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('5', 64)),
    'apollo-partial-request',
    'apollo-partial-person-1'
  ) ->> 'outcome',
  'bound',
  'the submitted partial-batch callback binds its provider request'
);
select is(
  public.apply_apollo_enrichment_callback_v1(
    repeat('5', 64),
    'apollo-partial-request',
    'SUCCEEDED',
    repeat('9', 64),
    jsonb_build_object(
      'apollo_person_id', 'apollo-partial-person-1',
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
  'the submitted partial-batch callback applies normally'
);
select is(
  public.settle_apollo_enrichment_callback_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('7', 64)),
    'cancelled',
    'batch_cancelled_before_provider'
  ) ->> 'outcome',
  'settled',
  'an unsubmitted partial-batch callback can settle without a provider charge'
);
select results_eq(
  $$select status, response_status, consumed_count, quota_count_after
    from public.antonia_quota_operations where operation_id = 'apollo-partial-operation'$$,
  $$values ('completed'::text, 202::integer, 1::integer, 1::integer)$$,
  'partial settlement retains only quota that crossed the provider boundary'
);
select is(
  (select leads_investigated from public.antonia_daily_usage
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and date = timezone('utc', now())::date),
  1,
  'partial settlement returns unsubmitted quota to the organization bucket'
);
select is(
  public.settle_apollo_enrichment_callback_v1(
    (select id from public.apollo_enrichment_callbacks where token_hash = repeat('d', 64)),
    'cancelled',
    'batch_cancelled_before_provider'
  ) ->> 'outcome',
  'settled',
  'an unsubmitted user-scoped callback settles without a provider charge'
);
select results_eq(
  $$select status, response_status, consumed_count, quota_count_after
    from public.antonia_quota_operations where operation_id = 'apollo-user-partial-operation'$$,
  $$values ('completed'::text, 202::integer, 1::integer, 1::integer)$$,
  'partial settlement retains only submitted user-scoped quota'
);
select is(
  (select usage_count from public.antonia_user_daily_usage
    where organization_id = 'd1000000-0000-4000-8000-000000000001'
      and user_id = 'd0000000-0000-4000-8000-000000000001'
      and date = timezone('utc', now())::date
      and resource = 'investigate'),
  1,
  'partial settlement returns unsubmitted quota to the user bucket'
);

select is(
  jsonb_array_length(
    public.lookup_research_messaging_subject_v1('suppressed-apollo@example.test')
      -> 'peopleSearchLeads'
  ),
  2,
  'privacy export finds suppressed targets through their private subject references'
);
select is(
  public.delete_native_research_messaging_subject_v1('suppressed-apollo@example.test') ->> 'outcome',
  'deleted',
  'privacy deletion accepts a suppressed Apollo subject'
);
select ok(
  not exists (
    select 1 from public.people_search_leads
    where id in ('suppressed-apollo-target', 'apollo-null-email-target')
  ) and not exists (
    select 1 from public.apollo_contact_subject_refs
    where target_table = 'people_search_leads'
      and target_lead_id in ('suppressed-apollo-target', 'apollo-null-email-target')
  ),
  'privacy deletion removes the suppressed target and its private subject reference'
);
select results_eq(
  $$select
      response_payload #>> '{enriched,0,email}',
      response_payload #>> '{enriched,0,primaryPhone}',
      response_payload #>> '{enriched,1,email}',
      response_payload #>> '{enriched,1,primaryPhone}'
    from public.antonia_quota_operations
    where operation_id = 'apollo-historical-replay-operation'$$,
  $$values (
    null::text,
    null::text,
    'unrelated-apollo@example.test'::text,
    '+15550100004'::text
  )$$,
  'privacy suppression scrubs only the matching item from a historical batch replay'
);
select is(
  public.delete_native_research_messaging_subject_v1('apollo-enriched@example.test') ->> 'outcome',
  'deleted',
  'privacy deletion accepts a subject with a completed Apollo callback'
);
select ok(
  not exists (
    select 1 from public.enriched_leads where id = 'apollo-callback-target'
  ) and not exists (
    select 1 from public.apollo_enrichment_callbacks where token_hash = repeat('9', 64)
  ) and not exists (
    select 1 from public.apollo_contact_subject_refs
    where target_table = 'enriched_leads' and target_lead_id = 'apollo-callback-target'
  ),
  'privacy deletion removes the Apollo target, callback metadata, and subject reference'
);

reset role;
select * from finish();
rollback;
