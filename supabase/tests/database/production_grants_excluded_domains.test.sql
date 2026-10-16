begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select plan(11);
-- The pages that read these tables with the person's session (Historial de campañas, Pipeline, Tabla, Bajas) need table privileges.
select ok(has_table_privilege('authenticated','campaigns','select'),'campaigns are read by the session client');
select ok(has_table_privilege('authenticated','campaign_steps','select'),'campaign steps are read by the session client');
select ok(has_table_privilege('authenticated','opportunities','select'),'opportunities are read by the session client');
select ok(has_table_privilege('authenticated','unsubscribed_emails','insert'),'unsubscribes are written by the session client');
-- Excluded domains: the table every send checks, behind RLS, for the members of its organization only.
select has_table('public','excluded_domains','excluded domains exist');
select ok((select relrowsecurity from pg_class where oid='public.excluded_domains'::regclass),'excluded domains have RLS');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='excluded_domains'),3,'view, insert and delete policies');
select ok(not has_table_privilege('anon','excluded_domains','select'),'no anonymous read');
select ok(not has_table_privilege('authenticated','excluded_domains','update'),'an excluded domain is removed, not edited');
select ok(not has_table_privilege('anon','excluded_domains','insert,update,delete,truncate'),'anonymous cannot change it either; TRUNCATE would skip RLS');
select ok(not has_table_privilege('authenticated','excluded_domains','truncate'),'the session cannot empty the list');
select * from finish();
rollback;
