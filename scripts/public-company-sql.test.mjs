import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import test from 'node:test';

// Installed outside the workspace; this runs real PostgreSQL in WASM, not Supabase.
const enginePath = path.join(process.env.LOCALAPPDATA, 'Temp/opencode/public-company-sql/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(enginePath).href);
const migration = readFileSync('supabase/migrations/20260909034401_public_company_research.sql', 'utf8');

test('actual migration SQL: RLS, service grants, lease ownership, refresh and TTL', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create table public.organizations(id uuid primary key);
      create function public.is_current_user_organization_member(id uuid) returns boolean language sql as
        $$ select id::text = current_setting('test.organization',true) $$;
      insert into public.organizations values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
    `);
    await db.exec(migration);
    const org = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const identity = { apolloOrganizationId: 'apollo-org-1', domain: 'acme.example', country: 'CL', language: 'es', depth: 'standard', version: 'public-company/2:report-v2/p3-claims/4' };
    const claim = async (refresh = false, organization = org) => (await db.query(
      'select public.claim_public_company_research_v1($1,$2,$3) as result', [organization, identity, refresh])).rows[0].result;
    await db.exec("set role service_role; set request.jwt.claim.role = 'service_role';");
    const first = await claim();
    assert.equal(first.state, 'miss');
    assert.equal((await claim()).state, 'busy');
    assert.equal((await claim(false, other)).state, 'miss');
    const complete = (artifact, organization = org, lifetime = 24) => db.query(`select public.complete_public_company_research_v1(
      $1,$2,$3,'{"sources":[]}'::jsonb,statement_timestamp() - interval '1 minute',
      statement_timestamp() - interval '1 minute' + make_interval(hours => $4)) as result`, [organization, artifact.id, artifact.lease_token, lifetime]);
    await assert.rejects(complete(first.artifact, org, 25), /invalid public evidence lifetime/);
    await assert.rejects(complete(first.artifact, other), /lease lost/);
    const completed = (await complete(first.artifact)).rows[0].result;
    assert.equal(completed.revision, 1);
    await assert.rejects(db.query('update public.public_company_research set expires_at=null where id=$1', [first.artifact.id]), /check constraint/);
    const hit = await claim();
    assert.equal(hit.state, 'hit');
    assert.equal('lease_token' in hit.artifact, false);
    const refresh = await claim(true);
    assert.equal(refresh.state, 'miss');
    assert.equal((await claim()).state, 'hit');
    assert.equal((await claim(true)).state, 'busy');
    await assert.rejects(complete(first.artifact), /lease lost/);
    assert.equal((await db.query('select public.release_public_company_research_v1($1,$2,$3) as result', [org, refresh.artifact.id, first.artifact.lease_token])).rows[0].result, false);
    await db.query('select public.release_public_company_research_v1($1,$2,$3)', [org, refresh.artifact.id, refresh.artifact.lease_token]);
    assert.equal((await claim()).artifact.expires_at, hit.artifact.expires_at);
    const abandoned = await claim(true);
    await db.query("update public.public_company_research set lease_until = clock_timestamp() - interval '1 second' where id=$1", [abandoned.artifact.id]);
    const successor = await claim(true);
    await assert.rejects(complete(abandoned.artifact), /lease lost/);
    assert.equal((await complete(successor.artifact)).rows[0].result.revision, 2);
    await db.query("update public.public_company_research set captured_at=clock_timestamp()-interval '25 hours',expires_at=clock_timestamp()-interval '1 hour' where id=$1", [first.artifact.id]);
    assert.equal((await claim()).expired, true);
    await assert.rejects(db.query('select public.claim_public_company_research_v1($1,$2,false)', [org, { ...identity, ownerUserId: 'private' }]), /invalid public identity/);
    await db.exec("set request.jwt.claim.role='authenticated';");
    await assert.rejects(claim(), /not authorized/);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.role='authenticated'; set test.organization='${org}';`);
    assert.equal((await db.query('select id,organization_id,payload from public.public_company_research')).rows.length, 1);
    await assert.rejects(db.query('select lease_token from public.public_company_research'), /permission denied/);
    await assert.rejects(claim(), /permission denied/);
    await assert.rejects(db.query("update public.public_company_research set revision=10"), /permission denied/);
    await assert.rejects(db.query('delete from public.public_company_research'), /permission denied/);
    await db.exec(`set test.organization='00000000-0000-4000-8000-000000000003';`);
    assert.equal((await db.query('select id,payload from public.public_company_research')).rows.length, 0);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select id,payload from public.public_company_research'), /permission denied/);
    await assert.rejects(claim(), /permission denied/);
  } finally { await db.close(); }
});
