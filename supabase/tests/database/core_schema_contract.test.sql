begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(30);

select has_table('public', 'organizations', 'organizations table exists');
select has_table('public', 'organization_members', 'organization_members table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'leads', 'leads table exists');
select has_table('public', 'campaigns', 'campaigns table exists');
select has_table('public', 'lead_responses', 'lead_responses table exists');
select has_table('public', 'research_snapshots', 'research_snapshots table exists');
select has_table('public', 'messaging_drafts', 'messaging_drafts table exists');
select has_table('public', 'lead_research_reports', 'lead_research_reports table exists');

select col_type_is('public', 'campaigns', 'id', 'uuid', 'campaign IDs retain the UUID contract');
select col_type_is(
  'public',
  'campaigns',
  'organization_id',
  'uuid',
  'campaign organization IDs retain the UUID contract'
);
select col_type_is('public', 'leads', 'id', 'uuid', 'lead IDs retain the UUID contract');
select col_not_null('public', 'leads', 'user_id', 'leads always retain an owning user');
select has_column(
  'public',
  'lead_research_reports',
  'report_id',
  'lead research reports expose the compatibility report ID'
);
select col_type_is(
  'public',
  'lead_research_reports',
  'report_id',
  'text',
  'the compatibility report ID remains text'
);
select is(
  (
    select a.attgenerated
    from pg_attribute a
    where a.attrelid = 'public.lead_research_reports'::regclass
      and a.attname = 'report_id'
      and not a.attisdropped
  ),
  's'::"char",
  'report_id is a stored generated column'
);
select ok(
  to_regclass('public.lead_research_reports_report_id_idx') is not null,
  'report_id keeps its unique lookup index'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.organizations'::regclass),
  true,
  'organizations has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.organization_members'::regclass),
  true,
  'organization_members has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'profiles has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.leads'::regclass),
  true,
  'leads has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.lead_responses'::regclass),
  true,
  'lead_responses has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.research_snapshots'::regclass),
  true,
  'research_snapshots has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.messaging_drafts'::regclass),
  true,
  'messaging_drafts has RLS enabled'
);

select ok(
  has_table_privilege('authenticated', 'public.leads', 'select')
    and has_table_privilege('authenticated', 'public.leads', 'insert')
    and has_table_privilege('authenticated', 'public.leads', 'update')
    and has_table_privilege('authenticated', 'public.leads', 'delete'),
  'authenticated users receive the lead privileges mediated by RLS'
);
select ok(
  has_table_privilege('authenticated', 'public.lead_responses', 'select')
    and not has_table_privilege('authenticated', 'public.lead_responses', 'insert')
    and not has_table_privilege('authenticated', 'public.lead_responses', 'update')
    and not has_table_privilege('authenticated', 'public.lead_responses', 'delete'),
  'lead responses are read-only for authenticated users'
);
select ok(
  not has_table_privilege('authenticated', 'public.provider_tokens', 'select')
    and not has_table_privilege('authenticated', 'public.provider_tokens', 'insert')
    and not has_table_privilege('authenticated', 'public.provider_tokens', 'update')
    and not has_table_privilege('authenticated', 'public.provider_tokens', 'delete'),
  'provider tokens remain service-role-only'
);
select ok(
  to_regprocedure('public.create_messaging_draft_v1(jsonb,text)') is not null,
  'the atomic messaging draft creation RPC exists'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_messaging_draft_v1(jsonb,text)',
    'execute'
  ),
  'authenticated users can execute the RLS-aware messaging draft RPC'
);
select policies_are(
  'public',
  'leads',
  array[
    'Tenant members can delete leads',
    'Tenant members can insert leads',
    'Tenant members can read leads',
    'Tenant members can update leads'
  ],
  'leads retains its complete tenant policy set'
);

select * from finish();
rollback;
