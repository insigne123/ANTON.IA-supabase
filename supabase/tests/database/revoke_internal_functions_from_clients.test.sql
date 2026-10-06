begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(10);

-- Plan 12 (7): the worker's functions can't be called by anyone with the public key or a user session; the worker still can.
select ok(not has_function_privilege('anon', 'public.claim_antonia_tasks(integer, text, text)', 'execute'), 'anon cannot claim agent tasks');
select ok(not has_function_privilege('authenticated', 'public.claim_antonia_tasks(integer, text, text)', 'execute'), 'a signed-in user cannot claim agent tasks');
select ok(not has_function_privilege('anon', 'public.schedule_daily_mission_tasks()', 'execute'), 'anon cannot schedule mission tasks');
select ok(not has_function_privilege('anon', 'public.increment_daily_usage(uuid, date, integer, integer, integer, integer)', 'execute'), 'anon cannot inflate daily usage');
select ok(not has_function_privilege('authenticated', 'public.increment_daily_usage(uuid, date, integer, integer, integer, integer)', 'execute'), 'a signed-in user cannot inflate daily usage');
select ok(not has_function_privilege('anon', 'public.claim_suplia_tool_lease(uuid, text, integer, integer, uuid, uuid, uuid, jsonb)', 'execute'), 'anon cannot take tool leases');
select ok(not has_function_privilege('anon', 'public.release_suplia_tool_lease(text)', 'execute'), 'anon cannot release tool leases');
select ok(has_function_privilege('service_role', 'public.claim_antonia_tasks(integer, text, text)', 'execute'), 'the worker still claims tasks');
select ok(has_function_privilege('service_role', 'public.increment_daily_usage(uuid, date, integer, integer, integer, integer)', 'execute'), 'the worker still counts usage');
select ok(has_function_privilege('service_role', 'public.release_suplia_tool_lease(text)', 'execute'), 'the worker still releases leases');

select * from finish();
rollback;
