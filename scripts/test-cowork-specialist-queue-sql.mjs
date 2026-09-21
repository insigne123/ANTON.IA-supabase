// Isolated embedded PostgreSQL; never connects to Supabase or loads env files.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const native = process.argv.includes('--native');
const db = native
  ? await (await import('./cowork-isolated-postgres.mjs')).createIsolatedPostgres()
  : new (await import(process.env.COWORK_PGLITE_MODULE
    ? pathToFileURL(process.env.COWORK_PGLITE_MODULE).href : '@electric-sql/pglite')).PGlite();
const user = randomUUID(), org = randomUUID();
const assignments = ['analyst', 'verifier'].map(role => ({
  task: { role, objective: 'Revisar', evidence: [0] }, evidence: [{ index: 0, observation: { items: [] } }],
}));
const create = async () => {
  const id = randomUUID(), token = randomUUID();
  await db.query(`insert into cowork_runs(id,user_id,organization_id,status,lease_token,lease_expires_at,created_at,updated_at) values($1,$2,$3,'running',$4,now()+interval '180 seconds',now(),now())`, [id,user,org,token]);
  return { id, token };
};
const enqueue = async run => (await db.query('select cowork_enqueue_specialists($1,$2,$3) as ok', [run.id,run.token,JSON.stringify(assignments)])).rows[0].ok;
const take = async () => (await db.query('select * from cowork_take_specialist($1)', [user])).rows;
const finish = async job => (await db.query(`select cowork_finish_specialist($1,$2,true,'{"summary":"ok"}',null,null) as ok`, [job.id,job.lease_token])).rows[0].ok;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table organizations(id uuid primary key);
    create table organization_members(user_id uuid,organization_id uuid);
    create table cowork_access_grants(user_id uuid,enabled boolean);
    create function cowork_has_access(uuid) returns boolean language sql as 'select false';
    create table cowork_runs(id uuid primary key,user_id uuid,organization_id uuid,status text constraint cowork_runs_status_check check(status in ('queued','running','waiting_approval','completed','failed','cancelled')),lease_token uuid,lease_expires_at timestamptz,created_at timestamptz,updated_at timestamptz,parent_run_id uuid,depth integer not null default 0);
    create table cowork_run_events(run_id uuid,user_id uuid,organization_id uuid,kind text,payload jsonb);
  `);
  await db.query(`insert into auth.users values($1,'nicolas.yarur.g@yago.cl',now())`, [user]);
  await db.query('insert into organizations values($1)', [org]);
  await db.query('insert into organization_members values($1,$2)', [user,org]);
  await db.query('insert into cowork_access_grants values($1,true)', [user]);
  await db.exec(await readFile(new URL('../supabase/migrations/20260920205105_cowork_specialist_queue.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260920205152_cowork_model_budget.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260921010105_cowork_thread_model_budget.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260921015112_cowork_conversation_budget.sql', import.meta.url), 'utf8'));
  const budgetRun = await create();
  for(let i=0;i<5;i++) await db.query("select cowork_reserve_model_call($1,$2,'coordinator',null)",[budgetRun.id,budgetRun.token]);
  await assert.rejects(db.query("select cowork_reserve_model_call($1,$2,'coordinator',null)",[budgetRun.id,budgetRun.token]),/budget exhausted/);
  await db.query("update cowork_runs set status='completed' where id=$1",[budgetRun.id]);
  // Thread aggregate: a chain of runs shares one model budget.
  const reserveThread = (id,token)=>db.query("select cowork_reserve_model_call($1,$2,'coordinator',null)",[id,token]);
  const spawn = async (parent,depth) => {
    const id = randomUUID(), token = randomUUID();
    await db.query(`insert into cowork_runs(id,user_id,organization_id,status,lease_token,lease_expires_at,created_at,updated_at,parent_run_id,depth) values($1,$2,$3,'running',$4,now()+interval '180 seconds',now(),now(),$5,$6)`,
      [id,user,org,token,parent,depth]);
    return { id, token };
  };
  let head = { id: budgetRun.id, token: budgetRun.token };
  await db.query("update cowork_runs set status='running',lease_token=$2,lease_expires_at=now()+interval '180 seconds' where id=$1",[head.id,head.token]);
  for (let chain = 0; chain < 2; chain++) {
    head = await spawn(head.id, chain + 1);
    for (let i = 0; i < 5; i++) await reserveThread(head.id, head.token);
  }
  // Thread holds 5 + 5 + 5 = 15 calls (90000 tokens). The next reserve
  // (96000) passes; the following one (102000) exceeds the thread cap.
  head = await spawn(head.id, 3);
  await reserveThread(head.id, head.token);
  await assert.rejects(reserveThread(head.id, head.token), /budget exhausted/);
  // A sibling must count the calls made by the other branch, not reset them.
  const sibling = await spawn(budgetRun.id, 1);
  await assert.rejects(reserveThread(sibling.id, sibling.token), /budget exhausted/);
  const thread = await db.query(`select count(*)::int as calls, coalesce(sum(output_reserved),0)::int as tokens
    from cowork_model_calls where run_id in (select id from cowork_runs where user_id=$1)`, [user]);
  assert.equal(thread.rows[0].calls, 16);
  assert.equal(thread.rows[0].tokens, 96000);
  // A self-parented run is an invalid ancestry, never a wider budget.
  const loop = await spawn(null, 0);
  await db.query('update cowork_runs set parent_run_id=id where id=$1', [loop.id]);
  await assert.rejects(reserveThread(loop.id, loop.token), /Invalid thread ancestry/);
  let deep = await create();
  for (let i=0; i<12; i++) deep = await spawn(deep.id, i+1);
  await reserveThread(deep.id, deep.token);
  deep = await spawn(deep.id, 13);
  await assert.rejects(reserveThread(deep.id, deep.token), /Invalid thread ancestry/);
  const foreign = await create();
  await db.query('update cowork_runs set organization_id=$2 where id=$1', [foreign.id, randomUUID()]);
  const foreignChild = await spawn(foreign.id, 1);
  await assert.rejects(reserveThread(foreignChild.id, foreignChild.token), /Invalid thread ancestry/);
  if (native) {
    const root = await create();
    for (let i=0; i<3; i++) {
      const branch = await spawn(root.id, 1);
      for (let call=0; call<5; call++) await reserveThread(branch.id, branch.token);
    }
    const left = await spawn(root.id, 1), right = await spawn(root.id, 1);
    const first = await db.connect(), second = await db.connect();
    const pid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
    await first.query('begin');
    await first.query("select cowork_reserve_model_call($1,$2,'coordinator',null)", [left.id, left.token]);
    // Hold the successful reservation uncommitted while the other connection
    // attempts to spend the last cup. Observe a real advisory-lock wait.
    const pending = second.query("select cowork_reserve_model_call($1,$2,'coordinator',null)", [right.id, right.token])
      .then(() => ({ accepted: true }), error => ({ error }));
    let waiting = false;
    try {
      for (let i=0; i<100; i++) {
        const state = await db.query("select wait_event from pg_stat_activity where pid=$1", [pid]);
        if (state.rows[0]?.wait_event === 'advisory') { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waiting, true, 'sibling reservation must wait on the shared root lock');
    } finally { await first.query('commit'); }
    const outcome = await pending;
    assert.match(outcome.error?.message || '', /budget exhausted/);
    const spent = await db.query(`select sum(output_reserved)::int as tokens from cowork_model_calls
      where run_id in (select id from cowork_runs where parent_run_id=$1)`, [root.id]);
    assert.equal(spent.rows[0].tokens, 96000);
    console.log('PASS: two independent PostgreSQL connections serialize sibling reservations; exactly one final reservation succeeds.');
  }
  const run = await create(); assert.equal(await enqueue(run), true);
  assert.equal(await enqueue(run), false);
  const [a] = await take(), [b] = await take(); assert.notEqual(a.id,b.id);
  await db.query('select cowork_reserve_model_call($1,$2,$3,$4)',[run.id,a.lease_token,a.role,a.id]);
  await assert.rejects(db.query('select cowork_reserve_model_call($1,$2,$3,$4)',[run.id,a.lease_token,a.role,a.id]),/budget exhausted/);
  assert.deepEqual(await take(), []);
  assert.equal(await finish(a), true); assert.equal(await finish(a), false);
  assert.equal((await db.query('select status from cowork_runs where id=$1',[run.id])).rows[0].status,'waiting_workers');
  assert.equal(await finish(b), true);
  assert.equal((await db.query('select status from cowork_runs where id=$1',[run.id])).rows[0].status,'queued');
  assert.equal((await db.query(`select count(*)::int as n from cowork_run_events where run_id=$1 and kind='tool.completed'`,[run.id])).rows[0].n,1);
  if (native) {
    const parallel = await create(); await enqueue(parallel);
    const one = await db.connect(), two = await db.connect();
    const claims = await Promise.all([one, two].map(connection => connection.query(
      'select * from cowork_take_specialist($1)', [user])));
    const jobs = claims.flatMap(result => result.rows);
    assert.ok(jobs.length >= 1 && jobs.length <= 2);
    // SKIP LOCKED may intentionally defer the second worker to a later tick.
    if (jobs.length === 1) jobs.push(...await take());
    assert.equal(jobs.length, 2);
    assert.notEqual(jobs[0].id, jobs[1].id);
    const completions = await Promise.all([one, two].map((connection, index) => connection.query(
      `select cowork_finish_specialist($1,$2,true,'{"summary":"ok"}',null,null) as ok`,
      [jobs[index].id, jobs[index].lease_token])));
    assert.ok(completions.every(result => result.rows[0].ok));
    assert.equal((await db.query('select status from cowork_runs where id=$1', [parallel.id])).rows[0].status, 'queued');
    assert.equal((await db.query("select count(*)::int as n from cowork_run_events where run_id=$1 and kind='tool.completed'", [parallel.id])).rows[0].n, 1);
    console.log('PASS: concurrent specialist claims are exclusive and concurrent publication resumes the coordinator exactly once.');
  }
  const interrupted = await create(); await enqueue(interrupted);
  const [lost] = await take();
  await db.query(`update cowork_specialist_tasks set lease_expires_at=now()-interval '1 second' where id=$1`,[lost.id]);
  const [remaining] = await take(); assert.notEqual(remaining.id,lost.id);
  assert.equal(await finish(lost),false); assert.equal(await finish(remaining),true);
  assert.equal((await db.query('select status from cowork_specialist_tasks where id=$1',[lost.id])).rows[0].status,'uncertain');
  const cancelled = await create(); await enqueue(cancelled); const [active] = await take();
  await db.query('select cowork_cancel_run($1,$2,$3)',[user,org,cancelled.id]);
  assert.equal(await finish(active),false); assert.deepEqual(await take(),[]);
  const revoked = await create(); await enqueue(revoked);
  await db.query('update cowork_access_grants set enabled=false');
  assert.deepEqual(await take(),[]);
  assert.equal((await db.query('select status from cowork_runs where id=$1',[revoked.id])).rows[0].status,'cancelled');
  const perms = (await db.query(`select has_function_privilege('authenticated','cowork_take_specialist(uuid)','execute') as browser,
    has_function_privilege('service_role','cowork_take_specialist(uuid)','execute') as worker,
    (select relrowsecurity from pg_class where oid='cowork_specialist_tasks'::regclass) as rls`)).rows[0];
  assert.deepEqual(perms,{browser:false,worker:true,rls:true});
  console.log('PASS: specialist queue SQL admission, exclusive claims, atomic resume, interrupted outcome, cancellation, revocation and permissions.');
} finally { await db.close(); }
