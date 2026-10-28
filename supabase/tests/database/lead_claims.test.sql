begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(17);

-- An organization with Ana, Beto and Carla, and Diego in another one.
insert into auth.users (id, email, email_confirmed_at)
values ('ce000000-0000-4000-8000-000000000001', 'claims-ana@antonia.test', now()),
  ('ce000000-0000-4000-8000-000000000002', 'claims-beto@antonia.test', now()),
  ('ce000000-0000-4000-8000-000000000003', 'claims-diego@antonia.test', now()),
  ('ce000000-0000-4000-8000-000000000004', 'claims-carla@antonia.test', now());
insert into public.profiles (id, email, full_name)
values ('ce000000-0000-4000-8000-000000000001', 'claims-ana@antonia.test', 'Ana Pérez'),
  ('ce000000-0000-4000-8000-000000000002', 'claims-beto@antonia.test', 'Beto Soto'),
  ('ce000000-0000-4000-8000-000000000003', 'claims-diego@antonia.test', 'Diego Rojas'),
  ('ce000000-0000-4000-8000-000000000004', 'claims-carla@antonia.test', 'Carla Díaz')
on conflict (id) do update set full_name = excluded.full_name;
insert into public.organizations (id, name)
values ('ce000000-0000-4000-8000-0000000000a1', 'Adjudicados QA'), ('ce000000-0000-4000-8000-0000000000a2', 'Otra empresa QA');
insert into public.organization_members (organization_id, user_id, role)
values ('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000001', 'member'),
  ('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000002', 'member'),
  ('ce000000-0000-4000-8000-0000000000a2', 'ce000000-0000-4000-8000-000000000003', 'member'),
  ('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000004', 'member');

-- Ana saved Marta 18 days ago, and Luis 40 days ago.
insert into public.leads (id, user_id, organization_id, name, company, title, email, apollo_id, linkedin_url, created_at)
values ('ce000000-0000-4000-8000-0000000000b1', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-0000000000a1',
    'Marta', 'Acme', 'Gerenta', 'Marta@Acme.test', 'ap-claims-1', 'https://www.linkedin.com/in/marta-claims/', now() - interval '18 days'),
  ('ce000000-0000-4000-8000-0000000000b2', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-0000000000a1',
    'Luis', 'Acme', 'Jefe', 'luis@acme.test', null, null, now() - interval '40 days');

select throws_ok(
  $$insert into public.leads (user_id, organization_id, name, company, title, email) values ('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1', 'Marta', 'Acme', 'Gerenta', ' marta@acme.test ')$$,
  'P0001', 'lead_claimed', 'Beto cannot save a person Ana saved 18 days ago, by email in any case');
select throws_ok(
  $$insert into public.enriched_leads (id, user_id, organization_id, full_name, source_provider_id) values ('claims-e1', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1', 'Marta', 'ap-claims-1')$$,
  'P0001', 'lead_claimed', 'nor in «Por escribir», by her Apollo id');
select throws_ok(
  $$insert into public.leads (user_id, organization_id, name, company, title, linkedin_url) values ('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1', 'Marta', 'Acme', 'Gerenta', 'linkedin.com/in/MARTA-claims?trk=x')$$,
  'P0001', 'lead_claimed', 'nor by her LinkedIn written another way');
select lives_ok(
  $$insert into public.enriched_leads (id, user_id, organization_id, full_name, email) values ('claims-e2', 'ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-0000000000a1', 'Marta', 'marta@acme.test')$$,
  'Ana saves her own again');
select lives_ok(
  $$insert into public.leads (user_id, organization_id, name, company, title, email) values ('ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1', 'Luis', 'Acme', 'Jefe', 'luis@acme.test')$$,
  'past 30 days since the first save, anyone may save the person');
select lives_ok(
  $$insert into public.leads (user_id, organization_id, name, company, title, email) values ('ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-0000000000a2', 'Marta', 'Acme', 'Gerenta', 'marta@acme.test')$$,
  'another organization never sees nor blocks it');

-- Beto saved Pedro 40 days ago; his claim expired and Ana saved Pedro 5 days ago, so Pedro is Ana's now.
insert into public.leads (id, user_id, organization_id, name, company, title, email, apollo_id, created_at)
values ('ce000000-0000-4000-8000-0000000000b3', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1',
  'Pedro', 'Acme', 'Jefe', 'pedro@acme.test', 'ap-claims-2', now() - interval '40 days');
insert into public.leads (user_id, organization_id, name, company, title, email, apollo_id, created_at)
values ('ce000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-0000000000a1', 'Pedro', 'Acme', 'Jefe', 'pedro@acme.test', 'ap-claims-2', now() - interval '5 days');
select lives_ok(
  $$insert into public.leads (id, user_id, organization_id, name, company, title, email, apollo_id) values ('ce000000-0000-4000-8000-0000000000b3', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1', 'Pedro Soto', 'Acme', 'Jefe', 'pedro@acme.test', 'ap-claims-2') on conflict (id) do update set name = excluded.name$$,
  'Beto still updates the Pedro he already had, as an upsert does');
select lives_ok(
  $$insert into public.enriched_leads (id, user_id, organization_id, full_name, source_provider_id) values ('claims-e3', 'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-0000000000a1', 'Pedro', 'ap-claims-2')$$,
  'and saves him again in «Por escribir»');
select throws_ok(
  $$insert into public.leads (user_id, organization_id, name, company, title, email) values ('ce000000-0000-4000-8000-000000000004', 'ce000000-0000-4000-8000-0000000000a1', 'Pedro', 'Acme', 'Jefe', 'pedro@acme.test')$$,
  'P0001', 'lead_claimed', 'Carla, who never had him, cannot: Ana holds him');

select is(
  (select owner_name || ' · ' || match_kind from public.lead_claims_v1('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000004', array['luis@acme.test'])),
  'Beto Soto · email', 'Luis is now Beto''s, as Carla reads it');
select is(
  (select count(*)::int from public.lead_claims_v1('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000001', array['luis@acme.test'])),
  0, 'Ana still has Luis: the screens let her keep working with him, as the database does');
select is(
  (select count(*)::int from public.lead_claims_v1('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000002', array['pedro@acme.test'], array['ap-claims-2'])),
  0, 'and Beto still has Pedro, although Ana holds him for the rest');
select is(
  (select ceil(extract(epoch from claimed_until - now()) / 86400)::int from public.lead_claims_v1('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000002', array['marta@acme.test'])),
  12, 'Marta has 12 days left with Ana');

select ok(not has_function_privilege('authenticated', 'public.lead_claim_lookup_v1(uuid, uuid, text[], text[], text[], integer)', 'execute'),
  'the internal lookup is not for clients');
select ok(not has_function_privilege('anon', 'public.lead_claims_v1(uuid, uuid, text[], text[], text[])', 'execute'), 'anon reads no claims');

-- Beto, signed in, reads claims of his own organization as himself only.
select set_config('request.jwt.claims', '{"sub":"ce000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*)::int from public.lead_claims_v1('ce000000-0000-4000-8000-0000000000a1', 'ce000000-0000-4000-8000-000000000002',
  array['marta@acme.test'], array['ap-claims-1'], array['linkedin.com/in/marta-claims'])), 3, 'Beto sees Marta held by email, Apollo id and LinkedIn');
select throws_ok(
  $$select * from public.lead_claims_v1('ce000000-0000-4000-8000-0000000000a2', 'ce000000-0000-4000-8000-000000000002', array['marta@acme.test'])$$,
  '42501', null, 'nor for another organization');
reset role;

select * from finish();
rollback;
