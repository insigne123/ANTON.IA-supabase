begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(14);

select has_table('public', 'email_finder_attempts', 'email finder attempts exist');
select is(
  (select relrowsecurity from pg_class where oid = 'public.email_finder_attempts'::regclass),
  true,
  'email finder attempts have RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.email_finder_attempts', 'select')
    and not has_table_privilege('anon', 'public.email_finder_attempts', 'select')
    and has_table_privilege('service_role', 'public.email_finder_attempts', 'update'),
  'email finder attempts are service-role-only'
);
select ok(
  has_function_privilege('service_role', 'public.claim_email_finder_candidates_v1(integer,timestamp with time zone,timestamp with time zone)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_email_finder_candidates_v1(integer,timestamp with time zone,timestamp with time zone)', 'execute'),
  'claiming leads is service-role-only'
);
select ok(
  has_function_privilege('service_role', 'public.complete_email_finder_attempt_v1(uuid,timestamp with time zone,text,text,text,text,text,integer,text,integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.complete_email_finder_attempt_v1(uuid,timestamp with time zone,text,text,text,text,text,integer,text,integer)', 'execute'),
  'saving a result is service-role-only'
);

insert into auth.users (id, email)
values ('e0000000-0000-4000-8000-000000000001', 'email-finder-owner@antonia.test');
insert into public.organizations (id, name)
values ('e1000000-0000-4000-8000-000000000001', 'Email Finder Org');

insert into public.enriched_leads (id, user_id, organization_id, full_name, first_name, last_name, email_status,
  enrichment_status, organization_domain)
values
  ('email-finder-lead', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
    'Ana Perez Soto', 'Ana', 'Perez Soto', 'unavailable', 'failed', 'acme-finder.test'),
  ('email-finder-has-email', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
    'Bob Ruiz', 'Bob', 'Ruiz', 'verified', 'completed', 'acme-finder.test');
update public.enriched_leads set email = 'bob.ruiz@acme-finder.test' where id = 'email-finder-has-email';
insert into public.people_search_leads (id, user_id, organization_id, name, first_name, last_name, email_status,
  enrichment_status, organization_website)
values ('email-finder-search-lead', 'e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
  'Diego Rojas', 'Diego', 'Rojas', 'unavailable', 'no_phone', 'https://www.beta-finder.test/contacto');

insert into public.apollo_enrichment_callbacks (
  user_id, organization_id, target_table, target_lead_id, token_hash, idempotency_key, operation_id, quota_resource,
  requested_fields, reveal_email, reveal_phone, status, terminal_state, terminal_at, expires_at, created_at
) values
  ('e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'enriched_leads', 'email-finder-lead',
    repeat('e1', 32), 'email-finder-callback-1', 'email-finder-op', 'enrich', array['person.email'], true, false,
    'terminal', 'no_data', now(), now() + interval '1 day', now() - interval '1 day'),
  ('e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'enriched_leads', 'email-finder-has-email',
    repeat('e2', 32), 'email-finder-callback-2', 'email-finder-op', 'enrich', array['person.email'], true, false,
    'terminal', 'succeeded', now(), now() + interval '1 day', now() - interval '1 day'),
  ('e0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'people_search_leads', 'email-finder-search-lead',
    repeat('e3', 32), 'email-finder-callback-3', 'email-finder-op', 'enrich', array['person.email', 'person.phone_numbers'], true, true,
    'terminal', 'succeeded', now(), now() + interval '1 day', now() - interval '1 day');

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

create temporary table claimed on commit drop as
select * from public.claim_email_finder_candidates_v1(50, now() - interval '60 days', now() - interval '15 minutes')
where target_lead_id like 'email-finder-%';

select is(
  (select array_agg(target_lead_id order by target_lead_id) from claimed),
  array['email-finder-lead', 'email-finder-search-lead'],
  'only leads that asked Apollo for the email and still have none are claimed'
);
select is(
  (select website_domain from claimed where target_lead_id = 'email-finder-search-lead'),
  'https://www.beta-finder.test/contacto',
  'the claim returns the website when the lead has no domain'
);
select is(
  (select count(*)::integer from public.claim_email_finder_candidates_v1(50, now() - interval '60 days', now() - interval '15 minutes')
    where target_lead_id like 'email-finder-%'),
  0,
  'a fresh claim is not handed out twice'
);

select is(
  (select public.complete_email_finder_attempt_v1(attempt_id, claimed_at, 'found', 'acme-finder.test',
    'Ana.Perez@acme-finder.test', 'verified', 'first.last', 2, 'safe', 0) from claimed where target_lead_id = 'email-finder-lead'),
  'found',
  'a confirmed address is saved'
);
select is(
  (select email || ' ' || email_status from public.enriched_leads where id = 'email-finder-lead'),
  'ana.perez@acme-finder.test verified',
  'the lead gets the address, lowercased, marked verified'
);
select is(
  (select public.complete_email_finder_attempt_v1(attempt_id, claimed_at, 'not_found', 'acme-finder.test',
    null, null, null, 1, 'invalid', 0) from claimed where target_lead_id = 'email-finder-lead'),
  'stale',
  'a claim that was already settled cannot be settled again'
);

update public.people_search_leads set email = 'diego@beta-finder.test' where id = 'email-finder-search-lead';
select is(
  (select public.complete_email_finder_attempt_v1(attempt_id, claimed_at, 'guessed', 'beta-finder.test',
    'diego.rojas@beta-finder.test', 'extrapolated', 'first.last', 0, 'catch_all_known', 0)
    from claimed where target_lead_id = 'email-finder-search-lead'),
  'lead_changed',
  'an address that arrived meanwhile is never overwritten'
);
select is(
  (select email from public.people_search_leads where id = 'email-finder-search-lead'),
  'diego@beta-finder.test',
  'the lead keeps the address it already had'
);
select throws_ok(
  $$select public.complete_email_finder_attempt_v1(gen_random_uuid(), now(), 'found', 'acme-finder.test',
    'someone@other.test', 'verified', null, 1, 'safe', 0)$$,
  '22023',
  'invalid email finder address',
  'an address outside the checked domain is refused'
);

select * from finish();
rollback;
