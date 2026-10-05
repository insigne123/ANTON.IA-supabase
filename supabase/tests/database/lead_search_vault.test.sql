begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(12);

insert into auth.users (id, email, email_confirmed_at)
values ('cd000000-0000-4000-8000-000000000001', 'lead-vault@antonia.test', now());
insert into public.organizations (id, name)
values ('cd000000-0000-4000-8000-0000000000a1', 'Vault QA');

select has_table('public', 'lead_search_vault', 'what Leads Finder brought waits in its own table');
select ok((select relrowsecurity from pg_class where oid = 'public.lead_search_vault'::regclass), 'with RLS on');

-- Contact data of people not yet enriched: only the server reads and writes it.
select ok(
  not has_table_privilege('authenticated', 'public.lead_search_vault', 'select')
  and not has_table_privilege('authenticated', 'public.lead_search_vault', 'insert')
  and not has_table_privilege('authenticated', 'public.lead_search_vault', 'update')
  and not has_table_privilege('authenticated', 'public.lead_search_vault', 'delete'),
  'signed-in accounts cannot read or write it directly'
);
select ok(
  not has_table_privilege('anon', 'public.lead_search_vault', 'select') and not has_table_privilege('anon', 'public.lead_search_vault', 'insert'),
  'anonymous visitors get nothing'
);
select ok(
  has_table_privilege('service_role', 'public.lead_search_vault', 'select')
  and has_table_privilege('service_role', 'public.lead_search_vault', 'insert')
  and has_table_privilege('service_role', 'public.lead_search_vault', 'delete'),
  'the server saves, reads and removes it'
);

select lives_ok($$
  insert into public.lead_search_vault (organization_id, provider, provider_lead_id, searched_by, contact_encrypted)
  values ('cd000000-0000-4000-8000-0000000000a1', 'leads_finder', 'lf_0123456789abcdef01234567', 'cd000000-0000-4000-8000-000000000001', 'enc:v1.aXY.dGFn.Y2lwaGVy')
$$, 'the server keeps an encrypted contact under its opaque id');
select ok(
  (select expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour' from public.lead_search_vault
    where provider_lead_id = 'lf_0123456789abcdef01234567'),
  'it expires in 30 days'
);
select throws_ok($$
  insert into public.lead_search_vault (organization_id, provider, provider_lead_id, contact_encrypted)
  values ('cd000000-0000-4000-8000-0000000000a1', 'leads_finder', 'lf_0123456789abcdef01234567', 'enc:v1.b3Rybw.dGFn.Y2lwaGVy')
$$, '23505', null, 'one row per person found, per organization');
select throws_ok($$
  insert into public.lead_search_vault (organization_id, provider, provider_lead_id, contact_encrypted)
  values ('cd000000-0000-4000-8000-0000000000a1', 'leads_finder', 'lf_aaaaaaaaaaaaaaaaaaaaaaaa', '{"email":"ana@retail.cl"}')
$$, '23514', null, 'a contact in clear is refused');
select throws_ok($$
  insert into public.lead_search_vault (organization_id, provider, provider_lead_id, contact_encrypted)
  values ('cd000000-0000-4000-8000-0000000000a1', 'leads_finder', 'ana@retail.cl', 'enc:v1.aXY.dGFn.Y2lwaGVy')
$$, '23514', null, 'the id is opaque, never an email');
select throws_ok($$
  insert into public.lead_search_vault (organization_id, provider, provider_lead_id, contact_encrypted, expires_at)
  values ('cd000000-0000-4000-8000-0000000000a1', 'leads_finder', 'lf_bbbbbbbbbbbbbbbbbbbbbbbb', 'enc:v1.aXY.dGFn.Y2lwaGVy', now() + interval '1 year')
$$, '23514', null, 'nothing is kept longer than a month');

delete from public.organizations where id = 'cd000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from public.lead_search_vault where organization_id = 'cd000000-0000-4000-8000-0000000000a1'), 0,
  'deleting the organization deletes what it searched');

select * from finish();
rollback;
