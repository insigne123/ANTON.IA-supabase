begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(10);

insert into auth.users (id, email, email_confirmed_at)
values ('cc000000-0000-4000-8000-000000000001', 'opportunities-ticket@antonia.test', now()),
  ('cc000000-0000-4000-8000-000000000002', 'opportunities-ticket-other@antonia.test', now());

select has_table('public', 'commercial_opportunity_tickets', 'each person keeps their Mercado Público ticket in its own table');
select ok((select relrowsecurity from pg_class where oid = 'public.commercial_opportunity_tickets'::regclass), 'with RLS on');

-- A credential: only the server reads and writes it.
select ok(
  not has_table_privilege('authenticated', 'public.commercial_opportunity_tickets', 'select')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_tickets', 'insert')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_tickets', 'update')
  and not has_table_privilege('authenticated', 'public.commercial_opportunity_tickets', 'delete'),
  'signed-in accounts cannot read or write it directly'
);
select ok(
  not has_table_privilege('anon', 'public.commercial_opportunity_tickets', 'select')
  and not has_table_privilege('anon', 'public.commercial_opportunity_tickets', 'insert'),
  'anonymous visitors get nothing'
);
select ok(
  has_table_privilege('service_role', 'public.commercial_opportunity_tickets', 'select')
  and has_table_privilege('service_role', 'public.commercial_opportunity_tickets', 'insert')
  and has_table_privilege('service_role', 'public.commercial_opportunity_tickets', 'delete'),
  'the server reads, saves and removes it'
);

select lives_ok($$
  insert into public.commercial_opportunity_tickets (user_id, ticket_encrypted, ticket_hint, verified_at)
  values ('cc000000-0000-4000-8000-000000000001', 'enc:v1.aXY.dGFn.Y2lwaGVy', '1A2B', now())
$$, 'the server saves an encrypted ticket with its last four characters');
select throws_ok($$
  insert into public.commercial_opportunity_tickets (user_id, ticket_encrypted)
  values ('cc000000-0000-4000-8000-000000000001', 'enc:v1.b3Rybw.dGFn.Y2lwaGVy')
$$, '23505', null, 'one ticket per person');
select throws_ok($$
  insert into public.commercial_opportunity_tickets (user_id, ticket_encrypted)
  values ('cc000000-0000-4000-8000-000000000002', 'F8537A18-6766-4DEF-9E59-426B4FEE2844')
$$, '23514', null, 'a ticket in clear is refused');
select throws_ok($$
  update public.commercial_opportunity_tickets set ticket_hint = 'F8537A18-6766' where user_id = 'cc000000-0000-4000-8000-000000000001'
$$, '23514', null, 'the hint is at most four characters, never the ticket');

delete from auth.users where id = 'cc000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.commercial_opportunity_tickets where user_id = 'cc000000-0000-4000-8000-000000000001'),
  0,
  'deleting the account deletes its ticket'
);

select * from finish();
rollback;
