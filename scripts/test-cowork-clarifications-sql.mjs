// Isolated Postgres/WASM contract check. Never loads env files or connects to Supabase.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
if (!process.env.PGLITE_MODULE) throw new Error('Explicit PGLITE_MODULE required');
const { PGlite } = require(process.env.PGLITE_MODULE);
const db = new PGlite();
const user = '00000000-0000-4000-8000-000000000001', org = '00000000-0000-4000-8000-000000000002', parent = '00000000-0000-4000-8000-000000000003', request = '00000000-0000-4000-8000-000000000004';
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.organization_members(user_id uuid,organization_id uuid);
    create table public.cowork_access_grants(user_id uuid,enabled boolean);
    create table public.cowork_runs(id uuid primary key default gen_random_uuid(),user_id uuid,organization_id uuid,request_id uuid not null,
      message text,mode text,status text default 'queued',parent_run_id uuid,root_run_id uuid,depth integer default 0,unique(user_id,organization_id,request_id),unique(id,user_id,organization_id),
      foreign key(parent_run_id,user_id,organization_id) references public.cowork_runs(id,user_id,organization_id));
    create table public.cowork_run_events(sequence bigserial,run_id uuid,user_id uuid,organization_id uuid,kind text,payload jsonb);
    create function public.cowork_open_access(email text) returns boolean language sql as $$select email='owner@example.test'$$;
    insert into auth.users values('${user}','owner@example.test',now()); insert into public.organization_members values('${user}','${org}'); insert into public.cowork_access_grants values('${user}',true);`);
  const gate = readFileSync('supabase/migrations/20260930020000_cowork_access_policy.sql', 'utf8');
  const admit = gate.match(/create or replace function public\.cowork_admit_run\([\s\S]*?\$\$;/)?.[0];
  assert.ok(admit); await db.exec(admit);
  const root = readFileSync('supabase/migrations/20261001220000_cowork_thread_root.sql', 'utf8');
  await db.exec(root.slice(root.indexOf('create function public.cowork_runs_root_v1()'), root.indexOf('alter table public.cowork_runs alter column root_run_id')));
  await db.exec(readFileSync('supabase/migrations/20261009090000_cowork_pending_clarifications.sql', 'utf8'));
  await db.query(`insert into public.cowork_runs(id,user_id,organization_id,request_id,message,mode,status) values($1,$2,$3,gen_random_uuid(),'Propuesta original','approval','waiting_approval')`, [parent,user,org]);
  await db.query(`insert into public.cowork_run_events(run_id,user_id,organization_id,kind,payload) values($1,$2,$3,'approval.requested','{}')`, [parent,user,org]);
  const ask = (uid=user, oid=org, req=request, text='¿Cuánto cuesta?', source=parent) => db.query('select public.cowork_admit_clarification($1,$2,$3,$4,$5) as id', [uid,oid,req,text,source]);
  const first = (await ask()).rows[0].id;
  assert.equal((await ask()).rows[0].id, first, 'transport retry deduplicates');
  const rows = (await db.query('select id,parent_run_id,root_run_id,status,mode from public.cowork_runs order by id')).rows;
  assert.equal(rows.find(row=>row.id===parent).status, 'waiting_approval');
  assert.equal(rows.find(row=>row.id===first).parent_run_id, parent); assert.equal(rows.find(row=>row.id===first).root_run_id, parent);
  assert.equal(rows.find(row=>row.id===first).mode, 'approval');
  await assert.rejects(ask('00000000-0000-4000-8000-000000000099'), /Parent unavailable/);
  await assert.rejects(ask(user,'00000000-0000-4000-8000-000000000098'), /Parent unavailable/);
  await assert.rejects(ask(user,org,request,'otra pregunta'), /Idempotency conflict/);
  await db.exec('update public.cowork_access_grants set enabled=false');
  await assert.rejects(ask(), /Cowork access denied/);
  await db.exec('update public.cowork_access_grants set enabled=true');
  await db.query("update public.cowork_runs set status='completed' where id=$1", [parent]);
  assert.equal((await ask()).rows[0].id, first, 'a known retry survives parent resolution');
  await assert.rejects(ask(user,org,'00000000-0000-4000-8000-000000000005'), /Proposal is not pending/);
  const privileges = (await db.query("select has_function_privilege('authenticated','public.cowork_admit_clarification(uuid,uuid,uuid,text,uuid)','EXECUTE') as client,has_function_privilege('service_role','public.cowork_admit_clarification(uuid,uuid,uuid,text,uuid)','EXECUTE') as worker")).rows[0];
  assert.deepEqual(privileges,{client:false,worker:true});
  console.log('PASS: actual SQL admission gate, root trigger, preserved proposal, idempotency, scope, revocation and service-only execute. Isolated Postgres; no production migration.');
} finally { await db.close(); }
