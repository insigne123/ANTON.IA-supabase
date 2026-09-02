begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(9);

select has_table(
  'public',
  'enriched_opportunities',
  'enriched_opportunities is present after a clean migration replay'
);
select col_is_pk(
  'public',
  'enriched_opportunities',
  'id',
  'enriched_opportunities keeps id as its primary key'
);
select has_column(
  'public',
  'enriched_opportunities',
  'phone_numbers',
  'phone number support is present'
);
select has_column(
  'public',
  'enriched_opportunities',
  'updated_at',
  'updated_at support is present'
);
select has_column(
  'public',
  'enriched_opportunities',
  'email_status',
  'email status support is present'
);
select has_column(
  'public',
  'enriched_opportunities',
  'contacted_count',
  'contacted count support is present'
);
select policies_are(
  'public',
  'enriched_opportunities',
  array[
    'Users can delete their own or org enriched opportunities',
    'Users can insert their own or org enriched opportunities',
    'Users can update their own or org enriched opportunities',
    'Users can view their own or org enriched opportunities'
  ],
  'enriched opportunities retains its expected RLS policy set'
);
select ok(
  (
    select with_check is not null
    from pg_policies
    where schemaname = 'public'
      and tablename = 'enriched_opportunities'
      and policyname = 'Users can update their own or org enriched opportunities'
  ),
  'enriched opportunities update policy validates the resulting tenant scope'
);
select ok(
  has_function_privilege('service_role', 'public.increment_contacted_count(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.increment_contacted_count(text)', 'execute')
    and not has_function_privilege('anon', 'public.increment_contacted_count(text)', 'execute'),
  'increment_contacted_count is restricted to service role'
);

select * from finish();
rollback;
