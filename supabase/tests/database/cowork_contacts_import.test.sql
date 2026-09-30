begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(20);

-- The verified owner (the only Cowork account today) and an outsider.
insert into auth.users (id, email, email_confirmed_at)
values
  ('d0000000-0000-4000-8000-000000000001', 'nicolas.yarur.g@yago.cl', now()),
  ('d0000000-0000-4000-8000-000000000002', 'pgtap-cowork-import-outsider@antonia.test', now());

insert into public.organizations (id, name)
values
  ('d1000000-0000-4000-8000-000000000001', 'pgTAP Cowork import'),
  ('d1000000-0000-4000-8000-000000000002', 'pgTAP Cowork import outsider');

insert into public.organization_members (organization_id, user_id, role)
values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'owner'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'owner');

insert into public.cowork_access_grants (user_id, enabled)
values ('d0000000-0000-4000-8000-000000000001', true);

-- Turn 1 runs under a live lease and proposes the import. Turn 2 finished: it holds a
-- staged import to show that the row goes away with its run.
insert into public.cowork_runs (id, user_id, organization_id, request_id, message, mode, status, lease_token, lease_expires_at)
values
  ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
   'd3000000-0000-4000-8000-000000000001', 'Importa los contactos de la feria', 'approval', 'running',
   'd4000000-0000-4000-8000-000000000001', now() + interval '2 minutes'),
  ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
   'd3000000-0000-4000-8000-000000000002', 'Importa prospectos.xlsx', 'approval', 'completed',
   null, null);

select has_table('public', 'cowork_contacts_import_proposals', 'the staging table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.cowork_contacts_import_proposals'::regclass), 'the staging table has RLS on');
select ok(not has_table_privilege('authenticated', 'public.cowork_contacts_import_proposals', 'select')
  and not has_table_privilege('anon', 'public.cowork_contacts_import_proposals', 'select')
  and not has_table_privilege('authenticated', 'public.cowork_contacts_import_proposals', 'insert'),
  'no signed-in or anonymous account reads or writes staged imports');
select ok(has_table_privilege('service_role', 'public.cowork_contacts_import_proposals', 'insert')
  and has_table_privilege('service_role', 'public.cowork_contacts_import_proposals', 'select'),
  'the worker stages and reads imports');

-- A staged import: which column is which, the cleaned contacts and what was left out.
select lives_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, sheet, column_map, contacts, total_rows, duplicates, skipped, patch_hash)
    values ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'asistentes-feria-rrhh.csv', null, '{"name": "Nombre", "email": "Correo"}',
      '[{"name": "Camila Fuentes", "email": "cfuentes@adecco.cl"}, {"name": "Tomás Riquelme", "email": null}]',
      8, 3, 3, repeat('a', 64))$$,
  'an import with contacts, counts and a hash is staged'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    values ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'otra.csv', '{}', '[{"name": "Ana"}]', 1, repeat('b', 64))$$,
  '23505', null, 'one staged import per run'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'vacio.csv', '{}', '[]', 1, repeat('c', 64))$$,
  '23514', null, 'an import without contacts is refused'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'objeto.csv', '{}', '{"name": "Ana"}', 1, repeat('c', 64))$$,
  '23514', null, 'contacts must be a list'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    select 'd2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'grande.csv', '{}', jsonb_agg(jsonb_build_object('name', 'Contacto ' || n)), 501, repeat('c', 64)
    from generate_series(1, 501) as n$$,
  '23514', null, 'an import holds 500 contacts at most'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'hash.csv', '{}', '[{"name": "Ana"}]', 1, 'no-es-un-hash')$$,
  '23514', null, 'the hash is 64 hex characters'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'columnas.csv', '["Nombre"]', '[{"name": "Ana"}]', 1, repeat('c', 64))$$,
  '23514', null, 'the column map is an object'
);
select throws_ok(
  $$insert into public.cowork_contacts_import_proposals
      (run_id, user_id, organization_id, file_name, column_map, contacts, total_rows, patch_hash)
    values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002',
      'ajeno.csv', '{}', '[{"name": "Ana"}]', 1, repeat('c', 64))$$,
  '23503', null, 'an import belongs to the owner and organization of its run'
);

-- The live turn proposes the import; the run then waits for the person's decision.
select is(public.cowork_propose_effect('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
  'contacts_import', 'd2000000-0000-4000-8000-000000000001', 'contactsimport:' || repeat('a', 64), 'Importar 2 contactos (3 ya estaban)'),
  true, 'the lease holder proposes a contacts import');
select results_eq(
  $$select kind, status, target_id from public.cowork_effect_proposals where run_id = 'd2000000-0000-4000-8000-000000000001'$$,
  $$values ('contacts_import'::text, 'proposed'::text, 'contactsimport:' || repeat('a', 64))$$,
  'the proposal is recorded as a contacts import'
);
select is((select status from public.cowork_runs where id = 'd2000000-0000-4000-8000-000000000001'), 'waiting_approval',
  'the turn waits for approval');
select is((select payload ->> 'kind' from public.cowork_run_events
  where run_id = 'd2000000-0000-4000-8000-000000000001' and kind = 'approval.requested'), 'contacts_import',
  'the page is told what to review');
select throws_ok(
  $$select public.cowork_propose_effect('d2000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
    'contacts_export', 'd2000000-0000-4000-8000-000000000001', 'contactsexport:x', 'Exportar')$$,
  '22023', 'Unknown effect', 'an unknown effect is still refused'
);
select throws_ok(
  $$insert into public.cowork_effect_proposals (run_id, user_id, organization_id, kind, origin_run_id, target_id, label)
    values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
      'contacts_export', 'd2000000-0000-4000-8000-000000000002', 'x', 'Exportar')$$,
  '23514', null, 'the table refuses an unknown effect too'
);

-- The staged import goes away with its run.
insert into public.cowork_contacts_import_proposals
  (run_id, user_id, organization_id, file_name, sheet, column_map, contacts, total_rows, patch_hash)
values ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
  'prospectos.xlsx', 'Prospectos', '{"name": "Nombre"}', '[{"name": "Paula Herrera"}]', 6, repeat('d', 64));
delete from public.cowork_run_events where run_id = 'd2000000-0000-4000-8000-000000000002';
delete from public.cowork_runs where id = 'd2000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.cowork_contacts_import_proposals where run_id = 'd2000000-0000-4000-8000-000000000002'), 0,
  'deleting the run deletes its staged import');
select is((select count(*)::integer from public.cowork_contacts_import_proposals), 1, 'the other staged import stays');

select * from finish();
rollback;
