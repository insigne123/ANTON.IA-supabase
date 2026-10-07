begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(8);

insert into auth.users (id, email, email_confirmed_at)
values ('cd000000-0000-4000-8000-000000000001', 'opportunities-admin@antonia.test', now()),
  ('cd000000-0000-4000-8000-000000000002', 'opportunities-member@antonia.test', now());
insert into public.organizations (id, name)
values ('cd000000-0000-4000-8000-0000000000a1', 'Oportunidades QA');

select has_table('public', 'commercial_opportunity_members', 'the people an admin let into «Oportunidades» have their own table');
select ok((select relrowsecurity from pg_class where oid = 'public.commercial_opportunity_members'::regclass), 'with RLS on');

-- Whoever has access is decided on the server, after checking the role of whoever changes it.
select ok(
  not has_table_privilege('authenticated', 'public.commercial_opportunity_members', 'select')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_members', 'insert')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_members', 'delete'),
  'signed-in accounts cannot read or change it directly'
);
select ok(
  not has_table_privilege('anon', 'public.commercial_opportunity_members', 'select')
  and not has_table_privilege('anon', 'public.commercial_opportunity_members', 'insert'),
  'anonymous visitors get nothing'
);
select ok(
  has_table_privilege('service_role', 'public.commercial_opportunity_members', 'select')
  and has_table_privilege('service_role', 'public.commercial_opportunity_members', 'insert')
  and has_table_privilege('service_role', 'public.commercial_opportunity_members', 'delete'),
  'the server reads, grants and removes it'
);

select lives_ok($$
  insert into public.commercial_opportunity_members (organization_id, user_id, granted_by)
  values ('cd000000-0000-4000-8000-0000000000a1', 'cd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000001')
$$, 'an admin gives a member access');
select throws_ok($$
  insert into public.commercial_opportunity_members (organization_id, user_id)
  values ('cd000000-0000-4000-8000-0000000000a1', 'cd000000-0000-4000-8000-000000000002')
$$, '23505', null, 'once per person and organization');

delete from auth.users where id = 'cd000000-0000-4000-8000-000000000002';
select is(
  (select count(*)::int from public.commercial_opportunity_members where user_id = 'cd000000-0000-4000-8000-000000000002'),
  0,
  'deleting the account removes its access'
);

select * from finish();
rollback;
