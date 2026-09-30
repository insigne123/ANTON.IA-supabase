begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(18);

-- The owner, a teammate with a grant, one without, one whose email is not confirmed and one whose grant is off.
insert into auth.users (id, email, email_confirmed_at)
values
  ('f0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('f0000000-0000-4000-8000-000000000002', 'pgtap-cowork-granted@antonia.test', now()),
  ('f0000000-0000-4000-8000-000000000003', 'pgtap-cowork-no-grant@antonia.test', now()),
  ('f0000000-0000-4000-8000-000000000004', 'pgtap-cowork-unconfirmed@antonia.test', null),
  ('f0000000-0000-4000-8000-000000000005', 'pgtap-cowork-grant-off@antonia.test', now());

insert into public.organizations (id, name)
values
  ('f1000000-0000-4000-8000-000000000001', 'pgTAP Cowork access'),
  ('f1000000-0000-4000-8000-000000000002', 'pgTAP Cowork access other');

insert into public.organization_members (organization_id, user_id, role)
select 'f1000000-0000-4000-8000-000000000001', ('f0000000-0000-4000-8000-00000000000' || n)::uuid, case when n = 1 then 'owner' else 'member' end
from generate_series(1, 5) n;

insert into public.cowork_access_grants (user_id, enabled)
values
  ('f0000000-0000-4000-8000-000000000001', true),
  ('f0000000-0000-4000-8000-000000000002', true),
  ('f0000000-0000-4000-8000-000000000004', true),
  ('f0000000-0000-4000-8000-000000000005', false);

-- Whether a person has Cowork in an organization, as the page asks it (auth.uid()), and whether a turn is admitted.
create function pg_temp.has(p_user uuid, p_org uuid default 'f1000000-0000-4000-8000-000000000001') returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  return public.cowork_has_access(p_org);
end; $$;
create function pg_temp.admit(p_user uuid, p_org uuid default 'f1000000-0000-4000-8000-000000000001') returns text language plpgsql as $$
begin
  perform public.cowork_admit_run(p_user, p_org, gen_random_uuid(), 'Hola', 'approval');
  return 'admitted';
exception when insufficient_privilege then return 'denied';
end; $$;

-- The rule lives in one place, closed.
select has_table('public', 'cowork_access_policy', 'the access policy exists');
select results_eq($$select open_to_grants from public.cowork_access_policy$$, $$values (false)$$, 'it starts closed, in one row');
select ok(not has_table_privilege('authenticated', 'public.cowork_access_policy', 'select')
  and not has_table_privilege('anon', 'public.cowork_access_policy', 'select')
  and not has_function_privilege('authenticated', 'public.cowork_open_access(text)', 'execute')
  and has_function_privilege('service_role', 'public.cowork_open_access(text)', 'execute'),
  'the policy and the rule are the service role''s');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ilike '%nicolas.yarur.g@yago.cl%'),
  array['cowork_open_access'],
  'only cowork_open_access names the owner; every other function asks it'
);
select ok(to_regclass('public.cowork_contacts_import_proposals') is null
  or position('contacts_import' in pg_get_functiondef('public.cowork_propose_effect(uuid,uuid,text,uuid,text,text)'::regprocedure)) > 0,
  'M5 preserves contacts_import when M3 was applied first');
select ok(case when to_regprocedure('public.cowork_edit_campaign_definition(uuid,uuid,uuid,jsonb,jsonb,integer[])') is null then true
  else position('cowork_open_access' in pg_get_functiondef(to_regprocedure('public.cowork_edit_campaign_definition(uuid,uuid,uuid,jsonb,jsonb,integer[])'))) > 0 end,
  'M5 centralizes access in the M4 edit function when present');

-- Closed: exactly as before.
select is(pg_temp.has('f0000000-0000-4000-8000-000000000001'), true, 'closed: the owner has Cowork');
select is(pg_temp.admit('f0000000-0000-4000-8000-000000000001'), 'admitted', 'closed: the owner''s turn is admitted');
select is(pg_temp.has('f0000000-0000-4000-8000-000000000002'), false, 'closed: a teammate with a grant does not, as today');
select is(pg_temp.admit('f0000000-0000-4000-8000-000000000002'), 'denied', 'closed: nor is their turn admitted');

-- Open: the grant decides, with the confirmed email and the membership still required.
update public.cowork_access_policy set open_to_grants = true, updated_at = now();
select is(pg_temp.has('f0000000-0000-4000-8000-000000000002'), true, 'open: a teammate with a grant has Cowork');
select is(pg_temp.admit('f0000000-0000-4000-8000-000000000002'), 'admitted', 'open: and their turn is admitted');
select is(pg_temp.has('f0000000-0000-4000-8000-000000000003') or pg_temp.admit('f0000000-0000-4000-8000-000000000003') = 'admitted',
  false, 'open: without a grant, no');
select is(pg_temp.has('f0000000-0000-4000-8000-000000000004') or pg_temp.admit('f0000000-0000-4000-8000-000000000004') = 'admitted',
  false, 'open: with an unconfirmed email, no');
select is(pg_temp.has('f0000000-0000-4000-8000-000000000005') or pg_temp.admit('f0000000-0000-4000-8000-000000000005') = 'admitted',
  false, 'open: with the grant turned off, no');
select is(pg_temp.has('f0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002')
  or pg_temp.admit('f0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002') = 'admitted',
  false, 'open: in an organization they are not in, no');
select is(pg_temp.has('f0000000-0000-4000-8000-000000000001'), true, 'open: the owner still has Cowork');

select throws_ok($$insert into public.cowork_access_policy (singleton) values (false)$$, '23514', null, 'there is no second policy row');

select * from finish();
rollback;
