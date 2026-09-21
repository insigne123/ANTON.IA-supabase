// Embedded PostgreSQL only. No env files, network, production or real identities.
// Install @electric-sql/pglite outside the repo and set COWORK_PGLITE_MODULE
// to its dist/index.js, or install it in the local tool environment.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.COWORK_PGLITE_MODULE;
const { PGlite } = await import(moduleName ? pathToFileURL(moduleName).href : '@electric-sql/pglite');
const db = new PGlite();
const user = randomUUID(), org = randomUUID(), run = randomUUID();
let runLease = randomUUID();
let sequence = 0;
const hash = () => (++sequence).toString(16).padStart(64, '0');
const reserve = async (capability, fingerprint, lease = randomUUID(), attempt = runLease) => {
  const result = await db.query(`select * from public.cowork_reserve_operation_v2($1,$2,$3,$4,1,'{}'::jsonb,$5,$6,$7)`,
    [user, org, run, capability, fingerprint, lease, attempt]);
  return result.rows[0];
};
const finish = async (op, attempt = runLease) => (await db.query(
  `select public.cowork_finish_operation_v2($1,$2,$3,true,'{"ok":true}'::jsonb,null) as ok`,
  [op.id, op.lease_token, attempt])).rows[0].ok;
const newAttempt = async () => {
  runLease = randomUUID();
  await db.query(`update public.cowork_runs set lease_token=$1,lease_expires_at=now()+interval '180 seconds' where id=$2`, [runLease, run]);
};
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.organizations(id uuid primary key);
    create table public.organization_members(user_id uuid,organization_id uuid);
    create table public.cowork_access_grants(user_id uuid,enabled boolean);
    create table public.cowork_runs(id uuid primary key,user_id uuid,organization_id uuid,status text,lease_token uuid,lease_expires_at timestamptz);
    create table public.cowork_specialist_tasks(id uuid primary key,run_id uuid,role text,assignment jsonb,status text,lease_token uuid,lease_expires_at timestamptz);
    create function public.cowork_has_access(uuid) returns boolean language sql as 'select false';
  `);
  await db.query(`insert into auth.users values($1,'nicolas.yarur.g@yago.cl',now())`, [user]);
  await db.query('insert into public.organizations values($1)', [org]);
  await db.query('insert into public.organization_members values($1,$2)', [user, org]);
  await db.query('insert into public.cowork_access_grants values($1,true)', [user]);
  await db.query(`insert into public.cowork_runs values($1,$2,$3,'running',$4,now()+interval '180 seconds')`, [run,user,org,runLease]);
  for (const file of ['20260917120000_cowork_operations.sql', '20260920161555_cowork_operation_leases_v2.sql', '20260921022101_cowork_specialist_read_leases.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  const fingerprint = hash();
  const first = await reserve('leads.search', fingerprint);
  assert.equal(first.status, 'executing'); assert.equal(first.attempts, 1);
  const duplicate = await reserve('leads.search', fingerprint);
  assert.equal(duplicate.lease_token, first.lease_token);
  const previousAttempt = runLease;
  await newAttempt();
  const recovered = await reserve('leads.search', fingerprint);
  assert.equal(recovered.attempts, 2);
  assert.notEqual(recovered.lease_token, first.lease_token);
  assert.equal(await finish(first, previousAttempt), false);
  assert.equal(await finish(recovered), true);
  assert.equal((await reserve('leads.search', fingerprint)).status, 'completed');
  await assert.rejects(reserve('leads.search', fingerprint, randomUUID(), previousAttempt), /Run attempt unavailable/);

  const paidHash = hash();
  const paid = await reserve('specialists.analyst', paidHash);
  await newAttempt();
  const uncertain = await reserve('specialists.analyst', paidHash);
  assert.equal(uncertain.status, 'failed'); assert.equal(uncertain.error_code, 'outcome_unknown');
  assert.equal(uncertain.attempts, 1); assert.equal(await finish(paid), false);

  const deadlineHash = hash();
  const expired = await reserve('crm.search', deadlineHash);
  await db.query(`update public.cowork_operations set operation_expires_at=now()-interval '1 second' where id=$1`, [expired.id]);
  assert.equal(await finish(expired), false);
  assert.equal((await reserve('crm.search', deadlineHash)).attempts, 2);
  await newAttempt();
  assert.equal((await reserve('crm.search', deadlineHash)).attempts, 3);
  await newAttempt();
  const exhausted = await reserve('crm.search', deadlineHash);
  assert.equal(exhausted.status, 'failed'); assert.equal(exhausted.error_code, 'attempts_exhausted');

  for (const action of ['profile.get','missions.list','exceptions.list','campaigns.inbox','campaigns.plan',
    'campaigns.step_context','crm.collaboration','crm.record','privacy.contactability','privacy.contactability_batch']) {
    const key = hash(); const old = await reserve(action, key); await newAttempt();
    const retried = await reserve(action, key);
    assert.equal(retried.attempts, 2, action); assert.equal(await finish(old), false); assert.equal(await finish(retried), true);
  }
  const specialistToken = randomUUID();
  await db.query(`insert into cowork_specialist_tasks values($1,$2,'analyst',$3,'executing',$4,now()+interval '60 seconds')`,
    [randomUUID(),run,JSON.stringify({ task: { read: { action:'metrics.overview',input:'' } } }),specialistToken]);
  await db.query("update cowork_runs set status='waiting_workers',lease_token=null,lease_expires_at=null where id=$1", [run]);
  const specialistRead = async (action,input,key=hash()) => (await db.query(
    'select * from cowork_reserve_operation_v2($1,$2,$3,$4,1,$5,$6,$7,$8)',
    [user,org,run,action,JSON.stringify(input),key,randomUUID(),specialistToken])).rows[0];
  await assert.rejects(specialistRead('leads.get',''), /Specialist tool unavailable/);
  await assert.rejects(specialistRead('metrics.overview','wrong'), /Specialist tool unavailable/);
  await assert.rejects(specialistRead('send_email',''), /Specialist tool unavailable/);
  const tool = await specialistRead('metrics.overview','');
  assert.equal(await finish(tool,specialistToken), true);
  const late = await specialistRead('metrics.overview','');
  await db.query("update cowork_specialist_tasks set lease_expires_at=now()-interval '1 second'");
  assert.equal(await finish(late,specialistToken), false);
  await assert.rejects(specialistRead('metrics.overview',''), /Run attempt unavailable/);
  await db.query("update cowork_runs set status='running' where id=$1", [run]); await newAttempt();

  const revoked = await reserve('files.list', hash());
  await db.query('update public.cowork_access_grants set enabled=false where user_id=$1', [user]);
  assert.equal(await finish(revoked), false);
  await assert.rejects(reserve('files.list', hash()), /Access revoked/);
  await db.query('update public.cowork_access_grants set enabled=true where user_id=$1', [user]);
  await db.query(`update public.cowork_runs set status='cancelled' where id=$1`, [run]);
  assert.equal(await finish(revoked), false);
  await assert.rejects(reserve('files.list', hash()), /Run attempt unavailable/);

  const permissions = (await db.query(`select
    has_function_privilege('authenticated','public.cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid)','execute') as browser,
    has_function_privilege('anon','public.cowork_finish_operation_v2(uuid,uuid,uuid,boolean,jsonb,text)','execute') as anonymous,
    has_function_privilege('service_role','public.cowork_reserve_operation_v2(uuid,uuid,uuid,text,integer,jsonb,text,uuid,uuid)','execute') as worker,
    (select relrowsecurity from pg_class where oid='public.cowork_operations'::regclass) as rls`)).rows[0];
  assert.deepEqual(permissions, { browser: false, anonymous: false, worker: true, rls: true });
  console.log('PASS: PostgreSQL migration, exclusive tokens, attempt fencing, replay, read recovery, uncertain provider result, bounded retries, expiry, revocation, cancellation and RPC permissions.');
} finally { await db.close(); }
