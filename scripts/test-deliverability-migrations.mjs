// Isolated PostgreSQL WASM. No network or environment files. Run with the
// absolute PGlite module path as argv[2] when installed outside the workspace.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.role() returns text language sql as $$select 'service_role'::text$$;`);
await db.exec(await readFile('supabase/migrations/20260923030000_deliverability_cache.sql', 'utf8'));
const cols = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='cowork_deliverability_checks' order by 1`);
assert.deepEqual(cols.rows.map((row) => row.column_name).sort(),
  ['checked_at', 'domain', 'organization_id', 'result', 'updated_at']);
const rls = await db.query(`select relrowsecurity from pg_class where relname='cowork_deliverability_checks'`);
assert.equal(rls.rows[0].relrowsecurity, true);
const pk = await db.query(`select count(*)::int as n from pg_constraint where conrelid='cowork_deliverability_checks'::regclass and contype='p'`);
assert.equal(pk.rows[0].n, 1);
const org = (await db.query('select gen_random_uuid() as org')).rows[0].org;
await db.query('insert into cowork_deliverability_checks values ($1,$2,$3,now(),now())', [org, 'yago.cl', { overall: 'pass' }]);
await db.query('insert into cowork_deliverability_checks values ($1,$2,$3,now(),now()) on conflict (organization_id,domain) do update set result=excluded.result', [org, 'yago.cl', { overall: 'warn' }]);
assert.equal((await db.query('select result->>\'overall\' as o from cowork_deliverability_checks')).rows[0].o, 'warn');
await assert.rejects(db.query('insert into cowork_deliverability_checks values ($1,$2,$3,now(),now())', [org, '', {}]), /domain/);
console.log('PASS: cache table+RLS+PK, upsert per org+domain, empty domain rejected.');
await db.close();
