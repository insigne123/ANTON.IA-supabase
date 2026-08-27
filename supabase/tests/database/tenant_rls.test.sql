begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(31);

insert into auth.users (id, email)
values
  ('a0000000-0000-4000-8000-000000000001', 'pgtap-owner@antonia.test'),
  ('a0000000-0000-4000-8000-000000000002', 'pgtap-member@antonia.test'),
  ('a0000000-0000-4000-8000-000000000003', 'pgtap-outsider@antonia.test');

update public.profiles
set full_name = case id
  when 'a0000000-0000-4000-8000-000000000001' then 'pgTAP Owner'
  when 'a0000000-0000-4000-8000-000000000002' then 'pgTAP Member'
  else 'pgTAP Outsider'
end
where id in (
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003'
);

insert into public.organizations (id, name)
values
  ('a1000000-0000-4000-8000-000000000001', 'pgTAP RLS Primary'),
  ('a1000000-0000-4000-8000-000000000002', 'pgTAP RLS Outsider');

insert into public.organization_members (organization_id, user_id, role)
values
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'member'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'owner');

insert into public.leads (id, user_id, organization_id, name, title, company, status)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Primary Lead',
    'VP Sales',
    'Primary Company',
    'saved'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000002',
    'Outsider Lead',
    'Founder',
    'Outsider Company',
    'saved'
  );

insert into public.contacted_leads (
  id, user_id, organization_id, lead_id, status, email, created_at
)
values
  (
    'pgtap-contacted-primary',
    'a0000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'replied',
    'primary@example.test',
    now()
  ),
  (
    'pgtap-contacted-outsider',
    'a0000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000002',
    'replied',
    'outsider@example.test',
    now()
  );

insert into public.lead_responses (id, contacted_id, organization_id, type, content)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'pgtap-contacted-primary',
    'a1000000-0000-4000-8000-000000000001',
    'reply',
    'Primary response'
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    'pgtap-contacted-outsider',
    'a1000000-0000-4000-8000-000000000002',
    'reply',
    'Outsider response'
  );

insert into public.unified_crm_data (id, organization_id, stage, owner)
values
  (
    'pgtap-crm-primary',
    'a1000000-0000-4000-8000-000000000001',
    'qualified',
    'Primary owner'
  ),
  (
    'pgtap-crm-outsider',
    'a1000000-0000-4000-8000-000000000002',
    'new',
    'Outsider owner'
  );

insert into public.antonia_exceptions (
  id, organization_id, category, title, payload
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'approval_required',
  'Server-only exception',
  '{}'::jsonb
);

select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select results_eq(
  $$select name from public.organizations where name like 'pgTAP RLS %' order by name$$,
  $$values ('pgTAP RLS Primary'::text)$$,
  'owner sees only the primary organization'
);
select results_eq(
  $$select user_id::text
    from public.organization_members
    where organization_id = 'a1000000-0000-4000-8000-000000000001'
    order by user_id$$,
  $$values
    ('a0000000-0000-4000-8000-000000000001'::text),
    ('a0000000-0000-4000-8000-000000000002'::text)$$,
  'owner sees both primary organization members'
);
select results_eq(
  $$select id::text from public.profiles where id::text like 'a0000000-%' order by id$$,
  $$values
    ('a0000000-0000-4000-8000-000000000001'::text),
    ('a0000000-0000-4000-8000-000000000002'::text)$$,
  'owner sees profiles only within the shared organization'
);
select results_eq(
  $$select id::text from public.leads where id::text like 'a2000000-%' order by id$$,
  $$values ('a2000000-0000-4000-8000-000000000001'::text)$$,
  'owner sees only primary tenant leads'
);
select results_eq(
  $$with changed as (
      update public.organizations
      set name = name
      where id = 'a1000000-0000-4000-8000-000000000001'
      returning id
    ) select count(*)::bigint from changed$$,
  array[1::bigint],
  'owner can update the primary organization'
);
select results_eq(
  $$select id::text from public.lead_responses where id::text like 'a3000000-%' order by id$$,
  $$values ('a3000000-0000-4000-8000-000000000001'::text)$$,
  'owner reads only primary tenant replies'
);
select throws_ok(
  $$insert into public.lead_responses (organization_id, type, content)
    values ('a1000000-0000-4000-8000-000000000001', 'reply', 'client write')$$,
  '42501',
  'permission denied for table lead_responses',
  'authenticated clients cannot author lead responses'
);
select results_eq(
  $$select id from public.unified_crm_data where id like 'pgtap-crm-%' order by id$$,
  $$values ('pgtap-crm-primary'::text)$$,
  'owner reads only primary tenant CRM metadata'
);
select lives_ok(
  $$insert into public.unified_crm_data (id, organization_id, stage)
    values (
      'pgtap-crm-owner-created',
      'a1000000-0000-4000-8000-000000000001',
      'new'
    )$$,
  'owner can create CRM metadata in the primary tenant'
);
select throws_ok(
  $$insert into public.unified_crm_data (id, organization_id, stage)
    values (
      'pgtap-crm-cross-tenant',
      'a1000000-0000-4000-8000-000000000002',
      'new'
    )$$,
  '42501',
  'new row violates row-level security policy for table "unified_crm_data"',
  'owner cannot create CRM metadata in an outsider tenant'
);
select throws_ok(
  $$select id from public.antonia_exceptions limit 1$$,
  '42501',
  'permission denied for table antonia_exceptions',
  'authenticated owners cannot read the server-owned exception queue directly'
);

reset role;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select results_eq(
  $$select name from public.organizations where name like 'pgTAP RLS %' order by name$$,
  $$values ('pgTAP RLS Primary'::text)$$,
  'member sees the primary organization'
);
select results_eq(
  $$select id::text from public.leads where id::text like 'a2000000-%' order by id$$,
  $$values ('a2000000-0000-4000-8000-000000000001'::text)$$,
  'member sees leads shared by the primary tenant'
);
select results_eq(
  $$with changed as (
      update public.organizations
      set name = name
      where id = 'a1000000-0000-4000-8000-000000000001'
      returning id
    ) select count(*)::bigint from changed$$,
  array[0::bigint],
  'non-owner member cannot update the organization'
);
select lives_ok(
  $$insert into public.leads (id, user_id, organization_id, name, title, company, status)
    values (
      'a2000000-0000-4000-8000-000000000003',
      'a0000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000001',
      'Member Lead',
      'Director',
      'Primary Company',
      'saved'
    )$$,
  'member can create an owned lead in the primary tenant'
);
select throws_ok(
  $$insert into public.leads (id, user_id, organization_id, name, title, company, status)
    values (
      'a2000000-0000-4000-8000-000000000004',
      'a0000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      'Forged Lead',
      'Director',
      'Primary Company',
      'saved'
    )$$,
  '42501',
  'new row violates row-level security policy for table "leads"',
  'member cannot create a lead owned by another user'
);
select throws_ok(
  $$update public.leads
    set organization_id = 'a1000000-0000-4000-8000-000000000002'
    where id = 'a2000000-0000-4000-8000-000000000001'$$,
  '42501',
  'new row violates row-level security policy for table "leads"',
  'member cannot move a shared lead into an outsider tenant'
);

select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role)
    values (
      'a1000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000002',
      'member'
    )$$,
  '42501',
  'permission denied for table organization_members',
  'member cannot self-join an outsider organization'
);
select results_eq(
  $$select id from public.unified_crm_data where id like 'pgtap-crm-%' order by id$$,
  $$values
    ('pgtap-crm-owner-created'::text),
    ('pgtap-crm-primary'::text)$$,
  'member reads CRM metadata shared by the primary tenant'
);
select results_eq(
  $$with changed as (
      update public.unified_crm_data
      set stage = 'contacted'
      where id = 'pgtap-crm-primary'
      returning id
    ) select count(*)::bigint from changed$$,
  array[1::bigint],
  'member can update CRM metadata in the primary tenant'
);

reset role;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select results_eq(
  $$select name from public.organizations where name like 'pgTAP RLS %' order by name$$,
  $$values ('pgTAP RLS Outsider'::text)$$,
  'outsider sees only the outsider organization'
);
select results_eq(
  $$select user_id::text
    from public.organization_members
    where organization_id in (
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002'
    )
    order by user_id$$,
  $$values ('a0000000-0000-4000-8000-000000000003'::text)$$,
  'outsider cannot enumerate primary organization members'
);
select results_eq(
  $$select id::text from public.profiles where id::text like 'a0000000-%' order by id$$,
  $$values ('a0000000-0000-4000-8000-000000000003'::text)$$,
  'outsider cannot read primary tenant profiles'
);
select results_eq(
  $$select id::text from public.leads where id::text like 'a2000000-%' order by id$$,
  $$values ('a2000000-0000-4000-8000-000000000002'::text)$$,
  'outsider cannot read primary tenant leads'
);
select results_eq(
  $$with changed as (
      update public.leads
      set name = 'Cross-tenant update'
      where id = 'a2000000-0000-4000-8000-000000000001'
      returning id
    ) select count(*)::bigint from changed$$,
  array[0::bigint],
  'outsider cannot update a primary tenant lead'
);
select results_eq(
  $$select id::text from public.lead_responses where id::text like 'a3000000-%' order by id$$,
  $$values ('a3000000-0000-4000-8000-000000000002'::text)$$,
  'outsider reads only outsider tenant replies'
);
select results_eq(
  $$select id from public.unified_crm_data where id like 'pgtap-crm-%' order by id$$,
  $$values ('pgtap-crm-outsider'::text)$$,
  'outsider reads only outsider tenant CRM metadata'
);
select results_eq(
  $$with changed as (
      update public.unified_crm_data
      set stage = 'cross-tenant update'
      where id = 'pgtap-crm-primary'
      returning id
    ) select count(*)::bigint from changed$$,
  array[0::bigint],
  'outsider cannot update primary tenant CRM metadata'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$select id from public.leads limit 1$$,
  '42501',
  'permission denied for table leads',
  'anonymous clients cannot read leads'
);
select throws_ok(
  $$select id from public.unified_crm_data limit 1$$,
  '42501',
  'permission denied for table unified_crm_data',
  'anonymous clients cannot read CRM metadata'
);
select throws_ok(
  $$select id from public.antonia_exceptions limit 1$$,
  '42501',
  'permission denied for table antonia_exceptions',
  'anonymous clients cannot read the server-owned exception queue'
);

reset role;
select * from finish();
rollback;
