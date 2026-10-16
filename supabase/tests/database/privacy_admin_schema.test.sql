begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(8);

-- What the privacy admin reads and writes exists, as the service role sees it.
select has_column('public', 'privacy_requests', 'last_action_type', 'privacy_requests.last_action_type');
select col_type_is('public', 'privacy_requests', 'last_action_at', 'timestamp with time zone', 'privacy_requests.last_action_at');
select col_not_null('public', 'privacy_requests', 'last_action_summary', 'privacy_requests.last_action_summary is never null');
select has_table('public', 'privacy_incidents', 'privacy_incidents exists');
select col_type_is('public', 'privacy_incidents', 'detected_at', 'timestamp with time zone', 'privacy_incidents.detected_at');

-- Only the service role reaches incidents: RLS on, and no table privilege for the session roles.
select ok((select relrowsecurity from pg_class where oid = 'public.privacy_incidents'::regclass), 'privacy_incidents has RLS');
select ok(not has_table_privilege('anon', 'public.privacy_incidents', 'select'), 'anon cannot read privacy_incidents');
select ok(not has_table_privilege('authenticated', 'public.privacy_incidents', 'select'), 'authenticated cannot read privacy_incidents');

select * from finish();
rollback;
