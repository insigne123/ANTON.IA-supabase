begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(3);
select ok((select 'statement_timeout=30s' = any(rolconfig) from pg_roles where rolname = 'service_role'), 'server queries get 30 s');
select ok((select rolconfig is null or not ('statement_timeout=30s' = any(rolconfig)) from pg_roles where rolname = 'anon'), 'the browser without a session keeps its own limit');
select ok((select rolconfig is null or not ('statement_timeout=30s' = any(rolconfig)) from pg_roles where rolname = 'authenticated'), 'and with a session too');
select * from finish();
rollback;
