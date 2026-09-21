// Ephemeral PostgreSQL/WASM validation; no network, secrets, env files or production access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
    create table public.enriched_leads(id text primary key);
    grant usage on schema public to anon, authenticated, service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260913100000_extension_linkedin_sends.sql', import.meta.url), 'utf8'));
  const org = '550e8400-e29b-41d4-a716-446655440000', user = '550e8400-e29b-41d4-a716-446655440001';
  const id = '550e8400-e29b-41d4-a716-446655440002', token = '550e8400-e29b-41d4-a716-446655440003';
  await db.query('insert into organizations values ($1)', [org]);
  await db.query('insert into auth.users values ($1)', [user]);
  await db.query('insert into enriched_leads values ($1)', ['legacy-text-lead']);
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.extension_linkedin_sends'::regclass")).rows[0].relrowsecurity, true);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from extension_linkedin_sends'), /permission denied/);
    await assert.rejects(db.query('delete from extension_linkedin_sends'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const sql = 'insert into extension_linkedin_sends(id,organization_id,user_id,lead_id,profile_url,message,claim_token) values ($1,$2,$3,$4,$5,$6,$7)';
  const values = [id, org, user, 'legacy-text-lead', 'https://www.linkedin.com/in/ana', 'Hola', token];
  await db.query(sql, values);
  await assert.rejects(db.query(sql, values), /duplicate key/);
  await assert.rejects(db.query("update extension_linkedin_sends set status='confirmed' where id=$1", [id]), /check constraint/);
  await db.query("update extension_linkedin_sends set status='confirmed',event_id='urn:event' where id=$1", [id]);
  assert.equal((await db.query('select status from extension_linkedin_sends')).rows[0].status, 'confirmed');
  await db.exec('reset role');
  await db.query('delete from enriched_leads where id=$1', ['legacy-text-lead']);
  assert.equal((await db.query('select * from extension_linkedin_sends')).rows.length, 0);
  console.log('PASS: migration syntax, text lead FK, RLS enabled, denied client access, service access, uniqueness, confirmation constraint and lead cascade (ephemeral PostgreSQL).');
} finally { await db.close(); }
