begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(20);

select has_table('public', 'antonia_credit_policies', 'versioned credit policies exist');
select has_table('public', 'antonia_credit_team_assignments', 'versioned credit team assignments exist');
select has_table('public', 'antonia_daily_credit_buckets', 'organization credit buckets exist');
select is(
  (select relrowsecurity from pg_class where oid = 'public.antonia_credit_policies'::regclass),
  true,
  'credit policies have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.antonia_credit_policies', 'select')
    and not has_table_privilege('authenticated', 'public.antonia_daily_credit_buckets', 'update'),
  'authenticated users cannot read policies or mutate buckets directly'
);
select ok(
  has_function_privilege('service_role', 'public.consume_antonia_organization_credits_v2(uuid,uuid,text,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.consume_antonia_organization_credits_v2(uuid,uuid,text,integer)', 'execute'),
  'organization credit consumption is service-role-only'
);

insert into auth.users (id, email)
values
  ('f0000000-0000-4000-8000-000000000001', 'credit-owner@antonia.test'),
  ('f0000000-0000-4000-8000-000000000002', 'credit-a@antonia.test'),
  ('f0000000-0000-4000-8000-000000000003', 'credit-b@antonia.test'),
  ('f0000000-0000-4000-8000-000000000004', 'credit-no-team@antonia.test');

insert into public.organizations (id, name)
values ('f1000000-0000-4000-8000-000000000001', 'Organization Credit Test');

insert into public.organization_members (organization_id, user_id, role)
values
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'owner'),
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'member'),
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', 'member'),
  ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000004', 'member');

insert into public.organization_reporting_groups (id, organization_id, name, slug, is_active)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Shared Team', 'shared-team', true);

insert into public.organization_reporting_group_members (organization_id, group_id, user_id, is_primary)
values
  ('f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', true),
  ('f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', true),
  ('f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003', true);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into public.antonia_credit_policies (
  organization_id, subject_type, mode, user_daily_limit, team_daily_limit, effective_from
) values (
  'f1000000-0000-4000-8000-000000000001', 'organization', 'hybrid', 3, 4, timezone('utc', now())::date
);

insert into public.antonia_credit_team_assignments (
  organization_id, user_id, reporting_group_id, effective_from
)
select 'f1000000-0000-4000-8000-000000000001', user_id,
       'f2000000-0000-4000-8000-000000000001', timezone('utc', now())::date
from (values
  ('f0000000-0000-4000-8000-000000000001'::uuid),
  ('f0000000-0000-4000-8000-000000000002'::uuid),
  ('f0000000-0000-4000-8000-000000000003'::uuid)
) users(user_id);

select results_eq(
  $$select (result ->> 'allowed')::boolean, (result ->> 'count')::integer,
           (result ->> 'limit')::integer, (result ->> 'user_count')::integer,
           (result ->> 'team_count')::integer
    from (select public.get_antonia_credit_status_v2(
      'f1000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-000000000001', timezone('utc', now())::date
    ) result) status$$,
  $$values (true, 0, 3, 0, 0)$$,
  'status preserves policy limits before daily buckets exist'
);

select is(
  (public.consume_antonia_organization_credits_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000002', 'search', 2
  ) ->> 'allowed')::boolean,
  true,
  'first user can reserve from both hybrid buckets'
);
select results_eq(
  $$select (result ->> 'user_count')::integer, (result ->> 'team_count')::integer
    from (select public.get_antonia_credit_status_v2(
      'f1000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-000000000002', timezone('utc', now())::date
    ) result) status$$,
  $$values (2, 2)$$,
  'hybrid status exposes both counters'
);
select is(
  (public.consume_antonia_organization_credits_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000003', 'enrich', 2
  ) ->> 'allowed')::boolean,
  true,
  'second user consumes the same team pool'
);
select is(
  (public.consume_antonia_organization_credits_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000002', 'investigate', 1
  ) ->> 'allowed')::boolean,
  false,
  'hybrid consumption stops when the shared team bucket is exhausted'
);
select results_eq(
  $$select usage_count from public.antonia_daily_credit_buckets
    where organization_id = 'f1000000-0000-4000-8000-000000000001'
      and bucket_type = 'user' and user_id = 'f0000000-0000-4000-8000-000000000002'$$,
  $$values (2)$$,
  'denied hybrid consumption does not increment the user bucket'
);
select is(
  public.release_antonia_organization_credits_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000002', timezone('utc', now())::date,
    'search', 1, 'hybrid', 'f2000000-0000-4000-8000-000000000001'
  ),
  true,
  'hybrid refund releases both captured buckets'
);
select results_eq(
  $$select usage_count from public.antonia_daily_credit_buckets
    where organization_id = 'f1000000-0000-4000-8000-000000000001'
      and bucket_type = 'team' and reporting_group_id = 'f2000000-0000-4000-8000-000000000001'$$,
  $$values (3)$$,
  'team bucket reflects the hybrid refund'
);
select is(
  (public.consume_antonia_organization_credits_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000002', 'investigate', 1
  ) ->> 'allowed')::boolean,
  true,
  'refunded hybrid capacity can be consumed again'
);
select results_eq(
  $$select (result ->> 'binding')::text, (result ->> 'count')::integer, (result ->> 'limit')::integer
    from (select public.get_antonia_credit_status_v2(
      'f1000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-000000000002', timezone('utc', now())::date
    ) result) status$$,
  $$values ('team'::text, 4, 4)$$,
  'status reports the exhausted team bucket as binding'
);

insert into public.antonia_credit_policies (
  organization_id, subject_type, user_id, mode, user_daily_limit, effective_from
) values (
  'f1000000-0000-4000-8000-000000000001', 'user',
  'f0000000-0000-4000-8000-000000000004', 'team', 3, timezone('utc', now())::date
);
select throws_ok(
  $$select public.get_antonia_credit_status_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000004', timezone('utc', now())::date
  )$$,
  '22023',
  'PRIMARY_CREDIT_TEAM_REQUIRED',
  'team mode fails explicitly without an effective primary team'
);

select is(
  (public.schedule_antonia_credit_policy_v1(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'user', 'f0000000-0000-4000-8000-000000000002',
    'user', 9, null, 'Scheduled test'
  ) ->> 'effective_from')::date,
  timezone('utc', now())::date + 1,
  'policy changes start on the next UTC day'
);
select is(
  (public.schedule_antonia_credit_team_assignment_v1(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000001'
  ) ->> 'effective_from')::date,
  timezone('utc', now())::date + 1,
  'team changes start on the next UTC day'
);
select is(
  (public.resolve_antonia_credit_context_v2(
    'f1000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000002', timezone('utc', now())::date
  ) ->> 'mode')::text,
  'hybrid',
  'a scheduled user policy does not reinterpret today'
);

select * from finish();
rollback;
