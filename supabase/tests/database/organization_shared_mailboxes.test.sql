begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(27);

-- One mailbox for a whole organization: whoever signs in with it shares the connection with the team.
insert into auth.users (id, email)
values
  ('c7000000-0000-4000-8000-000000000001', 'mailbox-connector@antonia.test'),
  ('c7000000-0000-4000-8000-000000000002', 'mailbox-colleague@antonia.test'),
  ('c7000000-0000-4000-8000-000000000003', 'mailbox-two-companies@antonia.test'),
  ('c7000000-0000-4000-8000-000000000004', 'mailbox-own@antonia.test'),
  ('c7000000-0000-4000-8000-000000000005', 'mailbox-newcomer@antonia.test'),
  ('c7000000-0000-4000-8000-000000000006', 'mailbox-outsider@antonia.test'),
  ('c7000000-0000-4000-8000-000000000007', 'mailbox-outsider-joins@antonia.test'),
  ('c7000000-0000-4000-8000-000000000008', 'mailbox-joins-with-own@antonia.test');

insert into public.organizations (id, name)
values
  ('c7100000-0000-4000-8000-000000000001', 'Shared Mailbox Team'),
  ('c7100000-0000-4000-8000-000000000002', 'Another Company');

insert into public.organization_members (organization_id, user_id, role)
values
  ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'admin'),
  ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 'member'),
  ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003', 'member'),
  ('c7100000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000003', 'member'),
  ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', 'member'),
  ('c7100000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000006', 'owner'),
  ('c7100000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000007', 'member');

insert into public.organization_shared_mailboxes (organization_id, provider, email)
values ('c7100000-0000-4000-8000-000000000001', 'outlook', 'contacto@equipo.test');

insert into public.provider_tokens (user_id, provider, refresh_token, updated_at)
values
  ('c7000000-0000-4000-8000-000000000001', 'outlook', 'team-token-1', now() - interval '1 hour'),
  ('c7000000-0000-4000-8000-000000000004', 'outlook', 'own-token', now() - interval '2 days'),
  ('c7000000-0000-4000-8000-000000000006', 'outlook', 'outsider-token', now() - interval '2 days'),
  ('c7000000-0000-4000-8000-000000000008', 'outlook', 'newcomer-own-token', now() - interval '2 days');

-- The table is the server's, and the function too.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.organization_shared_mailboxes'::regclass),
  'the list of shared mailboxes has row level security'
);
select ok(
  not has_table_privilege('authenticated', 'public.organization_shared_mailboxes', 'select')
    and not has_table_privilege('anon', 'public.organization_shared_mailboxes', 'select')
    and not has_table_privilege('authenticated', 'public.organization_shared_mailboxes', 'insert'),
  'a person with a session cannot read or write the list of shared mailboxes'
);
select ok(
  has_table_privilege('service_role', 'public.organization_shared_mailboxes', 'select')
    and has_table_privilege('service_role', 'public.organization_shared_mailboxes', 'update'),
  'the server reads and writes the list of shared mailboxes'
);
select ok(
  not has_function_privilege('anon', 'public.share_organization_mailbox_v1(uuid, uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.share_organization_mailbox_v1(uuid, uuid, text)', 'execute')
    and has_function_privilege('service_role', 'public.share_organization_mailbox_v1(uuid, uuid, text)', 'execute'),
  'only the server can share a mailbox'
);
select ok(
  not has_function_privilege('authenticated', 'public.adopt_organization_shared_mailbox_f()', 'execute')
    and not has_function_privilege('authenticated', 'public.drop_organization_shared_mailbox_f()', 'execute'),
  'the trigger functions cannot be called by a person'
);
select has_index('public', 'provider_tokens', 'provider_tokens_shared_organization_idx', array['shared_organization_id', 'provider'],
  'the copies of an organization''s mailbox are found by organization');
select has_index('public', 'organization_shared_mailboxes', 'organization_shared_mailboxes_connected_by_idx', array['connected_by'],
  'the mailboxes a person connected are found by person');
select throws_ok(
  $$insert into public.organization_shared_mailboxes (organization_id, provider, email)
    values ('c7100000-0000-4000-8000-000000000002', 'outlook', 'Contacto@Equipo.test')$$,
  '23514', null, 'the shared address is stored in lower case, so it compares equal to what the provider answers'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.share_organization_mailbox_v1('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'outlook')$$,
  '42501', 'not authorized', 'a person with a session cannot share a mailbox'
);
select set_config('request.jwt.claim.role', 'service_role', true);

-- An organization that lists no mailbox, someone who is not a member, a provider that is not the listed one: nothing happens.
select is(
  public.share_organization_mailbox_v1('c7100000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000006', 'outlook'),
  0, 'an organization that lists no mailbox shares nothing'
);
select is(
  public.share_organization_mailbox_v1('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000006', 'outlook'),
  0, 'someone outside the organization shares nothing'
);
select is(
  public.share_organization_mailbox_v1('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'google'),
  0, 'the other provider is not the listed mailbox'
);
select is(
  (select count(*)::integer from public.provider_tokens where shared_organization_id is not null),
  0, 'and no connection was marked as shared'
);

-- The connector signs in with the team's mailbox.
select is(
  public.share_organization_mailbox_v1('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'outlook'),
  1, 'the connection goes to the one colleague who can take it'
);
select is(
  (select refresh_token || '/' || shared_organization_id::text from public.provider_tokens
   where user_id = 'c7000000-0000-4000-8000-000000000002' and provider = 'outlook'),
  'team-token-1/c7100000-0000-4000-8000-000000000001', 'the colleague has the team''s connection, marked as the organization''s'
);
select is(
  (select shared_organization_id from public.provider_tokens
   where user_id = 'c7000000-0000-4000-8000-000000000001' and provider = 'outlook'),
  'c7100000-0000-4000-8000-000000000001'::uuid, 'the connector''s own row is marked as the organization''s'
);
select is(
  (select connected_by from public.organization_shared_mailboxes
   where organization_id = 'c7100000-0000-4000-8000-000000000001' and provider = 'outlook'),
  'c7000000-0000-4000-8000-000000000001'::uuid, 'the list remembers who connected it'
);
select is(
  (select count(*)::integer from public.provider_tokens where user_id = 'c7000000-0000-4000-8000-000000000003'),
  0, 'someone who also works in another company does not get it: the team''s mailbox must not write for that company'
);
select is(
  (select refresh_token || '/' || coalesce(shared_organization_id::text, 'own') from public.provider_tokens
   where user_id = 'c7000000-0000-4000-8000-000000000004' and provider = 'outlook'),
  'own-token/own', 'a mailbox a member connected for themselves is never replaced'
);

-- The mailbox is connected again (a new password): every copy follows, a personal mailbox still does not.
update public.provider_tokens set refresh_token = 'team-token-2', updated_at = now()
where user_id = 'c7000000-0000-4000-8000-000000000001' and provider = 'outlook';
select is(
  public.share_organization_mailbox_v1('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'outlook'),
  1, 'connecting it again reaches the same colleague'
);
select is(
  (select string_agg(refresh_token, ',' order by user_id) from public.provider_tokens
   where user_id in ('c7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000004')),
  'team-token-2,own-token', 'the copy has the new connection and the personal mailbox is untouched'
);

-- Someone joins later.
insert into public.organization_members (organization_id, user_id, role)
values ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000005', 'member');
select is(
  (select refresh_token || '/' || shared_organization_id::text from public.provider_tokens
   where user_id = 'c7000000-0000-4000-8000-000000000005' and provider = 'outlook'),
  'team-token-2/c7100000-0000-4000-8000-000000000001', 'a new member gets the team''s connection on joining'
);
insert into public.organization_members (organization_id, user_id, role)
values ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000007', 'member');
select is(
  (select count(*)::integer from public.provider_tokens where user_id = 'c7000000-0000-4000-8000-000000000007'),
  0, 'someone who joins while working in another company does not get it'
);
insert into public.organization_members (organization_id, user_id, role)
values ('c7100000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000008', 'member');
select is(
  (select string_agg(refresh_token || '/' || coalesce(shared_organization_id::text, 'own'), ',') from public.provider_tokens
   where user_id = 'c7000000-0000-4000-8000-000000000008'),
  'newcomer-own-token/own', 'joining never touches the mailbox the person already had'
);

-- Someone leaves.
delete from public.organization_members
where organization_id = 'c7100000-0000-4000-8000-000000000001'
  and user_id in ('c7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000004');
select is(
  (select count(*)::integer from public.provider_tokens where user_id = 'c7000000-0000-4000-8000-000000000002'),
  0, 'leaving the organization takes the team''s mailbox away'
);
select is(
  (select refresh_token from public.provider_tokens where user_id = 'c7000000-0000-4000-8000-000000000004' and provider = 'outlook'),
  'own-token', 'leaving keeps the mailbox the person connected for themselves'
);
select is(
  (select count(*)::integer from public.provider_tokens where shared_organization_id = 'c7100000-0000-4000-8000-000000000001'),
  2, 'the connector and the newcomer still write from the team''s mailbox'
);

select * from finish();
rollback;
