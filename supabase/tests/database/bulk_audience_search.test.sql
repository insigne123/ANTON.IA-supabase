begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(5);

-- Ana's organization holds two enriched people: one with the company's head count (a number) and one without it.
insert into auth.users (id, email, email_confirmed_at)
values ('ba000000-0000-4000-8000-000000000001', 'audiencia-ana@antonia.test', now());
insert into public.profiles (id, email, full_name)
values ('ba000000-0000-4000-8000-000000000001', 'audiencia-ana@antonia.test', 'Ana Pérez')
on conflict (id) do update set full_name = excluded.full_name;
insert into public.organizations (id, name)
values ('ba000000-0000-4000-8000-0000000000a1', 'Audiencia QA');
insert into public.organization_members (organization_id, user_id, role)
values ('ba000000-0000-4000-8000-0000000000a1', 'ba000000-0000-4000-8000-000000000001', 'member');
insert into public.enriched_leads (id, user_id, organization_id, full_name, email, title, company_name, organization_size, seniority)
values ('audiencia-e1', 'ba000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-0000000000a1',
    'Marta Rojas', 'marta@acme.test', 'Gerenta de Operaciones', 'Acme', 350, 'manager'),
  ('audiencia-e2', 'ba000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-0000000000a1',
    'Luis Soto', 'luis@beta.test', 'Jefe de Compras', 'Beta', null, null);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (public.search_bulk_audience_v1('ba000000-0000-4000-8000-0000000000a1', 'ba000000-0000-4000-8000-000000000001',
    'never_contacted', '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], 0, true, null, 25, 0, true) ->> 'total')::integer,
  2, 'the audience search answers when people carry the head count as a number');
select is(
  public.search_bulk_audience_v1('ba000000-0000-4000-8000-0000000000a1', 'ba000000-0000-4000-8000-000000000001',
    'never_contacted', '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], 0, true, null, 25, 0, true) #>> '{people,1,size}',
  '350', 'the head count comes back as text');
select is(
  public.search_bulk_audience_v1('ba000000-0000-4000-8000-0000000000a1', 'ba000000-0000-4000-8000-000000000001',
    'never_contacted', '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], 0, true, null, 25, 0, true) #>> '{people,0,size}',
  '', 'and stays empty for a person without it');
select is(
  public.search_bulk_audience_v1('ba000000-0000-4000-8000-0000000000a1', 'ba000000-0000-4000-8000-000000000001',
    'never_contacted', '{}'::text[], '{}'::text[], '{}'::text[], array['350'], '{}'::text[], 0, true, null, 25, 0, true) #>> '{people,0,email}',
  'marta@acme.test', 'the size filter keeps only the person whose company matches');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$select public.search_bulk_audience_v1('ba000000-0000-4000-8000-0000000000a1', 'ba000000-0000-4000-8000-000000000001',
    'never_contacted', '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], 0, true, null, 25, 0, true)$$,
  '42501', 'not authorized', 'only the server may search an audience');

select * from finish();
rollback;
