// Isolated PostgreSQL WASM. No network or environment files. Run with the
// absolute PGlite module path as argv[2] when installed outside the workspace.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.role() returns text language sql as $$select 'service_role'::text$$;
create table contacted_leads(id text primary key,organization_id uuid,user_id uuid,email text,company text,replied_at timestamptz,reply_message_id text,data jsonb);`);
await db.exec(await readFile('supabase/migrations/20260923020000_reply_detection_stage6.sql', 'utf8'));

const sweep = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='cowork_mailbox_sweep_state' order by 1`);
assert.deepEqual(sweep.rows.map((row) => row.column_name).sort(),
  ['last_completed_at', 'last_error', 'organization_id', 'page_token', 'provider', 'updated_at', 'user_id', 'window_days', 'window_started_at']);
const rls = await db.query(`select relrowsecurity from pg_class where relname='cowork_mailbox_sweep_state'`);
assert.equal(rls.rows[0].relrowsecurity, true);
const pk = await db.query(`select count(*)::int as n from pg_constraint where conrelid='cowork_mailbox_sweep_state'::regclass and contype='p'`);
assert.equal(pk.rows[0].n, 1);
const idx = await db.query(`select count(*)::int as n from pg_indexes where tablename='contacted_leads' and indexname='contacted_leads_org_company_idx'`);
assert.equal(idx.rows[0].n, 1);

const ids = (await db.query('select gen_random_uuid() as org, gen_random_uuid() as owner')).rows[0];
await db.query('insert into contacted_leads values ($1,$2,$3,$4,$5,null,null,null)', ['contact', ids.org, ids.owner, 'lead@example.test', 'Acme SpA']);
const due = new Date(Date.now() + 86400000).toISOString();
const derived = new Date().toISOString();
const origin = { replyEventKey: 'e1', threadKey: 't1', derivedAt: derived, derivedBy: ids.owner };
const work = (await db.query('select update_contacted_work($1,$2,$3,$4,$5) as value',
  [ids.org, ids.owner, 'contact', 'commitment', { title: 'Demo', kind: 'meeting', dueAt: due, origin }])).rows[0].value;
assert.equal(work.origin.replyEventKey, 'e1');
assert.equal(work.origin.derivedBy, ids.owner);
const legacy = (await db.query('select update_contacted_work($1,$2,$3,$4,$5) as value',
  [ids.org, ids.owner, 'contact', 'commitment', { title: 'Llamar', kind: 'call', dueAt: due }])).rows[0].value;
assert.equal(legacy.origin, null);
await assert.rejects(db.query('select update_contacted_work($1,$2,$3,$4,$5)',
  [ids.org, ids.owner, 'contact', 'commitment', { title: 'X', kind: 'meeting', dueAt: due, origin: { replyEventKey: '', threadKey: 't', derivedAt: derived, derivedBy: 'u' } }]), /invalid commitment origin/);
await assert.rejects(db.query('select update_contacted_work($1,$2,$3,$4,$5)',
  [ids.org, ids.owner, 'contact', 'commitment', { title: 'X', kind: 'meeting', dueAt: due, origin: 'no-object' }]), /invalid commitment origin/);
console.log('PASS: sweep state table+RLS+PK, account index, commitment origin valid/invalid/legacy. Grants and auth guards not simulated.');
await db.close();
