begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(5);

-- DB-01: the policies read auth.uid() once per query. What each person reads does not change.
select is((select count(*)::integer from pg_policies where schemaname = 'public'
    and (tablename like 'cowork%' or tablename = 'opportunities')
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(?<!SELECT )auth\.uid\(\)'),
  0, 'no Cowork policy nor one of «opportunities» calls auth.uid() row by row');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'opportunities'), 4,
  'the four policies of «opportunities» are still there');

insert into auth.users (id, email, email_confirmed_at)
values ('e0000000-0000-4000-8000-000000000101', 'nicolas.yarur.g@yago.cl', now()),
  ('e0000000-0000-4000-8000-000000000102', 'pgtap-rls-once-member@antonia.test', now());
insert into public.organizations (id, name) values ('e1000000-0000-4000-8000-000000000101', 'pgTAP RLS una vez');
insert into public.organization_members (organization_id, user_id, role)
values ('e1000000-0000-4000-8000-000000000101', 'e0000000-0000-4000-8000-000000000101', 'owner'),
  ('e1000000-0000-4000-8000-000000000101', 'e0000000-0000-4000-8000-000000000102', 'member');
insert into public.cowork_access_grants (user_id, enabled)
values ('e0000000-0000-4000-8000-000000000101', true), ('e0000000-0000-4000-8000-000000000102', true);
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status)
values ('e2000000-0000-4000-8000-000000000101', 'e0000000-0000-4000-8000-000000000101', 'e1000000-0000-4000-8000-000000000101',
  'e3000000-0000-4000-8000-000000000101', '¿A quién le escribo hoy?', 'approval', 'completed');
insert into public.opportunities (id, user_id, title)
values ('pgtap-rls-once', 'e0000000-0000-4000-8000-000000000101', 'pgTAP: oportunidad propia');

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000101', true);
set local role authenticated;
select is((select count(*)::integer from public.cowork_runs where id = 'e2000000-0000-4000-8000-000000000101'), 1,
  'the owner reads their own Cowork conversation');
select is((select count(*)::integer from public.opportunities where title = 'pgTAP: oportunidad propia'), 1,
  'and their own row of «opportunities»');
reset role;

select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000102', true);
set local role authenticated;
select is((select count(*)::integer from public.cowork_runs where id = 'e2000000-0000-4000-8000-000000000101')
    + (select count(*)::integer from public.opportunities where title = 'pgTAP: oportunidad propia'), 0,
  'another member of the organization reads neither');
reset role;

select * from finish();
rollback;
