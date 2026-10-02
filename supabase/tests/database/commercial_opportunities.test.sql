begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(19);

insert into auth.users (id, email)
values ('cb000000-0000-4000-8000-000000000001', 'opportunities-pilot@antonia.test');

insert into public.organizations (id, name)
values
  ('cb100000-0000-4000-8000-000000000001', 'Opportunities Pilot'),
  ('cb100000-0000-4000-8000-000000000002', 'Opportunities Other');

select has_table('public', 'commercial_opportunity_profiles', 'the search profiles exist');
select has_table('public', 'commercial_opportunities', 'the opportunities exist');
select has_table('public', 'commercial_opportunity_signals', 'their evidence exists');
select has_table('public', 'commercial_opportunity_runs', 'the record of each search exists');
select ok(
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.commercial_opportunity_profiles'::regclass, 'public.commercial_opportunities'::regclass,
    'public.commercial_opportunity_signals'::regclass, 'public.commercial_opportunity_runs'::regclass)),
  'row level security is on in the four tables'
);

-- Only the server reads and writes them, after checking OPPORTUNITIES_ALLOWED_EMAILS.
select ok(
  not has_table_privilege('authenticated', 'public.commercial_opportunities', 'select')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_signals', 'select')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_profiles', 'select')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_runs', 'select'),
  'members cannot read them directly'
);
select ok(
  not has_table_privilege('anon', 'public.commercial_opportunities', 'select')
  and not has_table_privilege('authenticated', 'public.commercial_opportunities', 'insert')
  and not has_table_privilege('authenticated', 'public.commercial_opportunities', 'update'),
  'nobody else writes them'
);
select ok(has_table_privilege('service_role', 'public.commercial_opportunities', 'insert'), 'the server writes them');

insert into public.commercial_opportunity_profiles (id, organization_id, created_by, name, offer, roles, regions, sources)
values ('cb200000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001',
  'Contratación operativa', 'Servicios transitorios y selección', '{operario,bodeguero}', '{Antofagasta}', '{hiring,tender}');
select throws_ok(
  $$insert into public.commercial_opportunity_profiles (organization_id, name, sources)
    values ('cb100000-0000-4000-8000-000000000001', 'Otra', '{hiring,leads}')$$,
  '23514', null, 'a source outside the four kinds is refused'
);

insert into public.commercial_opportunities (id, organization_id, profile_id, kind, dedupe_key, title, company_name, url, score, reasons, signal_count)
values ('cb300000-0000-4000-8000-000000000001', 'cb100000-0000-4000-8000-000000000001', 'cb200000-0000-4000-8000-000000000001',
  'hiring', 'acme.cl', 'Acme contrata operarios', 'Acme', 'https://acme.cl/empleos', 72, '{"14 avisos en 30 días"}', 1);
select throws_ok(
  $$insert into public.commercial_opportunities (organization_id, kind, dedupe_key, title)
    values ('cb100000-0000-4000-8000-000000000001', 'hiring', 'acme.cl', 'Acme otra vez')$$,
  '23505', null, 'the same company is one opportunity per organization'
);
select lives_ok(
  $$insert into public.commercial_opportunities (organization_id, kind, dedupe_key, title)
    values ('cb100000-0000-4000-8000-000000000002', 'hiring', 'acme.cl', 'Acme en otra organización')$$,
  'another organization keeps its own'
);
select throws_ok(
  $$insert into public.commercial_opportunities (organization_id, kind, dedupe_key, title)
    values ('cb100000-0000-4000-8000-000000000001', 'lead', 'x', 'Otra cosa')$$,
  '23514', null, 'an unknown kind is refused'
);
select throws_ok(
  $$update public.commercial_opportunities set status = 'won' where id = 'cb300000-0000-4000-8000-000000000001'$$,
  '23514', null, 'an unknown status is refused'
);
select throws_ok(
  $$update public.commercial_opportunities set url = 'javascript:alert(1)' where id = 'cb300000-0000-4000-8000-000000000001'$$,
  '23514', null, 'a link is a web address'
);

insert into public.commercial_opportunity_signals (organization_id, opportunity_id, source, external_id, title, publisher, url, posted_at)
values ('cb100000-0000-4000-8000-000000000001', 'cb300000-0000-4000-8000-000000000001', 'jsearch', 'job-1',
  'Operario de bodega', 'Computrabajo', 'https://cl.computrabajo.com/oferta/1', '2026-09-20T12:00:00Z');
select throws_ok(
  $$insert into public.commercial_opportunity_signals (organization_id, opportunity_id, source, external_id, title)
    values ('cb100000-0000-4000-8000-000000000001', 'cb300000-0000-4000-8000-000000000001', 'jsearch', 'job-1', 'Repetido')$$,
  '23505', null, 'the same job ad from the same source is kept once'
);
select throws_ok(
  $$insert into public.commercial_opportunity_signals (organization_id, opportunity_id, source, external_id, title)
    values ('cb100000-0000-4000-8000-000000000001', 'cb300000-0000-4000-8000-000000000001', 'apify', 'job-2', 'Otro')$$,
  '23514', null, 'an unknown source is refused'
);

select throws_ok(
  $$insert into public.commercial_opportunity_runs (organization_id, source, status)
    values ('cb100000-0000-4000-8000-000000000001', 'jsearch', 'succeeded')$$,
  '23514', null, 'a finished search has its end time'
);
select lives_ok(
  $$insert into public.commercial_opportunity_runs (organization_id, profile_id, source, status, finished_at, fetched, created, cost_estimate_usd)
    values ('cb100000-0000-4000-8000-000000000001', 'cb200000-0000-4000-8000-000000000001', 'jsearch', 'succeeded', now(), 40, 6, 0.05)$$,
  'a search is recorded with what it brought and what it cost'
);

delete from public.commercial_opportunities where id = 'cb300000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.commercial_opportunity_signals where opportunity_id = 'cb300000-0000-4000-8000-000000000001'),
  0, 'the evidence goes with its opportunity'
);

select * from finish();
rollback;
