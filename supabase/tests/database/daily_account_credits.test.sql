begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(27);

select has_table('public', 'antonia_user_daily_credits', 'shared daily credit buckets exist');
select has_table('public', 'antonia_suplia_research_credit_operations', 'premium research reservations use a private ledger');
select has_column('public', 'antonia_user_daily_credits', 'usage_count', 'shared buckets retain total usage');
select is(
  (select relrowsecurity from pg_class where oid = 'public.antonia_user_daily_credits'::regclass),
  true,
  'shared daily credit buckets have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.antonia_user_daily_credits', 'select')
    and not has_table_privilege('authenticated', 'public.antonia_user_daily_credits', 'update'),
  'authenticated users cannot read or mutate shared credit buckets directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.antonia_suplia_research_credit_operations', 'select')
    and not has_table_privilege('authenticated', 'public.antonia_suplia_research_credit_operations', 'insert')
    and not has_table_privilege('authenticated', 'public.antonia_suplia_research_credit_operations', 'update'),
  'authenticated users cannot forge premium research reservations'
);
select ok(
  has_function_privilege('service_role', 'public.consume_antonia_user_daily_credits_v1(uuid,text,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.consume_antonia_user_daily_credits_v1(uuid,text,integer)', 'execute'),
  'shared credit consumption is service-role-only'
);
select ok(
  has_function_privilege('service_role', 'public.release_antonia_user_daily_credits_v1(uuid,date,text,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.release_antonia_user_daily_credits_v1(uuid,date,text,integer)', 'execute'),
  'shared credit release is service-role-only'
);
select ok(
  has_function_privilege('service_role', 'public.consume_suplia_research_tool_credit_v1(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.consume_suplia_research_tool_credit_v1(uuid,uuid,uuid)', 'execute'),
  'premium research credit reservation is service-role-only'
);

insert into auth.users (id, email)
values
  ('e0000000-0000-4000-8000-000000000001', 'daily-credit-one@antonia.test'),
  ('e0000000-0000-4000-8000-000000000002', 'daily-credit-two@antonia.test'),
  ('e0000000-0000-4000-8000-000000000003', 'daily-credit-limited@antonia.test'),
  ('e0000000-0000-4000-8000-000000000004', 'daily-credit-claim@antonia.test');

insert into public.organizations (id, name)
values
  ('e1000000-0000-4000-8000-000000000001', 'Daily Credit Primary'),
  ('e1000000-0000-4000-8000-000000000002', 'Daily Credit Secondary');

insert into public.organization_members (organization_id, user_id, role)
values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'owner'),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 'member'),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'member'),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'member'),
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000004', 'member');

select throws_ok(
  $$insert into public.user_quota_overrides (user_id, daily_credit_limit)
    values ('e0000000-0000-4000-8000-000000000003', 51)$$,
  '23514',
  null,
  'account overrides cannot exceed 50 credits'
);

insert into public.user_quota_overrides (user_id, daily_credit_limit)
values ('e0000000-0000-4000-8000-000000000003', 7);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select is(
  public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'user', 'search', 30, 999
  ),
  jsonb_build_object(
    'allowed', true, 'count', 30, 'limit', 50,
    'search_count', 30, 'enrich_count', 0, 'investigate_count', 0
  ),
  'search reserves from the shared 50-credit allowance'
);

select is(
  public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    'user', 'enrich', 20, 999
  ),
  jsonb_build_object(
    'allowed', true, 'count', 50, 'limit', 50,
    'search_count', 30, 'enrich_count', 20, 'investigate_count', 0
  ),
  'a second organization consumes the same user allowance'
);

select is(
  public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'user', 'investigate', 1, 999
  ),
  jsonb_build_object(
    'allowed', false, 'count', 50, 'limit', 50,
    'search_count', 30, 'enrich_count', 20, 'investigate_count', 0
  ),
  'mixed resource consumption is denied after the shared total reaches 50'
);

select results_eq(
  $$select usage_count, search_count, enrich_count, investigate_count
    from public.antonia_user_daily_credits
    where user_id = 'e0000000-0000-4000-8000-000000000001'$$,
  $$values (50, 30, 20, 0)$$,
  'a denied request never increments the shared bucket'
);

select is(
  (public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000002',
    'user', 'research', 50, 999
  ) ->> 'allowed')::boolean,
  true,
  'different users have independent daily allowances'
);

select is(
  public.release_antonia_user_daily_credits_v1(
    'e0000000-0000-4000-8000-000000000001',
    timezone('utc', now())::date,
    'search',
    10
  ),
  true,
  'owned pre-provider work can release shared credits'
);

select is(
  public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    'user', 'investigate', 10, 999
  ),
  jsonb_build_object(
    'allowed', true, 'count', 50, 'limit', 50,
    'search_count', 20, 'enrich_count', 20, 'investigate_count', 10
  ),
  'released credits become available to another metered resource'
);

select is(
  public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000003',
    'user', 'search', 8, 999
  ),
  jsonb_build_object(
    'allowed', false, 'count', 0, 'limit', 7,
    'search_count', 0, 'enrich_count', 0, 'investigate_count', 0
  ),
  'a lower account override is enforced independently of caller input'
);

select is(
  (public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000003',
    'user', 'enrich', 7, 999
  ) ->> 'count')::integer,
  7,
  'an account can consume up to its lower override'
);

select results_eq(
  $$select count(*)::integer from public.antonia_user_daily_credits
    where user_id = 'e0000000-0000-4000-8000-000000000001'$$,
  $$values (1)$$,
  'one user has one daily bucket across all organizations'
);

select is(
  (select usage_count from public.antonia_user_daily_credits
   where user_id = 'e0000000-0000-4000-8000-000000000002'),
  50,
  'one exhausted account does not change another account total'
);

select is(
  (public.consume_antonia_daily_quota_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000004',
    'organization', 'search', 40, 999
  ) ->> 'count')::integer,
  40,
  'legacy caller scope still reserves from the account bucket'
);

select results_eq(
  $$select (claim ->> 'allowed')::boolean,
           (claim ->> 'claimed')::boolean,
           (claim ->> 'count')::integer,
           (claim ->> 'limit')::integer
    from (
      select public.claim_antonia_quota_operation_v1(
        'e1000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000004',
        'organization', 'enrich', 'shared-credit-claim', repeat('a', 64), 10, 999, 300
      ) as claim
    ) claimed$$,
  $$values (true, true, 50, 50)$$,
  'idempotent enrichment claims consume the shared account bucket'
);

select results_eq(
  $$select (claim ->> 'allowed')::boolean,
           (claim ->> 'claimed')::boolean,
           (claim ->> 'consumed')::integer,
           (claim ->> 'count')::integer
    from (
      select public.claim_antonia_quota_operation_v1(
        'e1000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000004',
        'user', 'enrich', 'shared-credit-claim', repeat('a', 64), 10, 50, 300
      ) as claim
    ) replayed$$,
  $$values (true, false, 10, 50)$$,
  'replaying the same enrichment operation never consumes twice'
);

select results_eq(
  $$select usage_count, search_count, enrich_count, investigate_count
    from public.antonia_user_daily_credits
    where user_id = 'e0000000-0000-4000-8000-000000000004'$$,
  $$values (50, 40, 10, 0)$$,
  'search and enrichment claims contribute to one resource breakdown'
);

select is(
  (public.claim_antonia_quota_operation_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000004',
    'user', 'investigate', 'shared-credit-denial', repeat('b', 64), 1, 50, 300
  ) ->> 'allowed')::boolean,
  false,
  'an idempotent investigation claim is denied at the shared limit'
);

select is(
  public.release_antonia_quota_operation_v1(
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000004',
    'enrich',
    'shared-credit-claim',
    (select claim_token from public.antonia_quota_operations
     where organization_id = 'e1000000-0000-4000-8000-000000000001'
       and user_id = 'e0000000-0000-4000-8000-000000000004'
       and resource = 'enrich'
       and operation_id = 'shared-credit-claim')
  ),
  true,
  'releasing unsubmitted enrichment work refunds the shared bucket'
);

select * from finish();
rollback;
