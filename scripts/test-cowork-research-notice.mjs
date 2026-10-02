// When the research a conversation asked for finishes, the conversation goes on by itself (research-notice.ts): it waits
// for the whole request or 10 minutes, goes after the newest finished turn, is told once (marked before it is admitted)
// and a marked notice that was never admitted is admitted later. No database or provider: an in-memory stand-in.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const U = '00000000-0000-4000-8000-0000000000e1';
const O = '00000000-0000-4000-8000-0000000000f1';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = Date.parse('2026-10-01T15:00:00Z');
const minutes = n => new Date(base + n * 60_000).toISOString();

const db = { cowork_runs: [], lead_research_jobs: [], cowork_run_events: [], leads: [], enriched_leads: [] };
const failures = { admit: 0, markers: 0 };
let admitted = [];
function matches(row, filters) {
  return filters.every(([op, column, value]) => op === 'eq' ? row[column] === value
    : op === 'in' ? value.includes(row[column])
      : op === 'like' ? String(row[column] || '').startsWith(value.replace(/%$/, ''))
        : op === 'gte' ? String(row[column]) >= value : true);
}
function query(table) {
  const filters = []; let order = null; let limit = Infinity;
  const rows = () => {
    let list = db[table].filter(row => matches(row, filters));
    if (order) list = [...list].sort((a, b) => (a[order.column] < b[order.column] ? -1 : a[order.column] > b[order.column] ? 1 : 0) * (order.ascending ? 1 : -1));
    return list.slice(0, limit);
  };
  const chain = {
    select: () => chain,
    eq: (column, value) => { filters.push(['eq', column, value]); return chain; },
    in: (column, value) => { filters.push(['in', column, value]); return chain; },
    like: (column, value) => { filters.push(['like', column, value]); return chain; },
    gte: (column, value) => { filters.push(['gte', column, value]); return chain; },
    order: (column, options) => { order = { column, ascending: options?.ascending !== false }; return chain; },
    limit: n => { limit = n; return chain; },
    maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    insert: async values => {
      if (table === 'cowork_run_events' && failures.markers) { failures.markers--; return { error: { message: 'insert failed' } }; }
      db[table].push(...(Array.isArray(values) ? values : [values])); return { error: null };
    },
  };
  return chain;
}
let seq = 100;
const client = {
  from: table => query(table),
  rpc: async (name, args) => {
    assert.equal(name, 'cowork_admit_followup');
    if (failures.admit) { failures.admit--; return { data: null, error: { message: 'temporarily unavailable' } }; }
    const parent = db.cowork_runs.find(run => run.id === args.p_parent_run_id && run.user_id === args.p_user_id);
    if (!parent || parent.status !== 'completed') return { data: null, error: { message: 'Parent unavailable' } };
    const existing = db.cowork_runs.find(run => run.request_id === args.p_request_id);
    if (existing) return existing.parent_run_id === args.p_parent_run_id ? { data: existing.id, error: null } : { data: null, error: { message: 'Idempotency conflict' } };
    const run = { id: id(++seq), user_id: args.p_user_id, organization_id: args.p_organization_id, status: 'queued', mode: args.p_mode,
      parent_run_id: args.p_parent_run_id, request_id: args.p_request_id, message: args.p_message, created_at: minutes(seq) };
    db.cowork_runs.push(run); admitted.push({ ...args, runId: run.id });
    return { data: run.id, error: null };
  },
};
globalThis.__notice = { client };
const bundle = await build({ entryPoints: ['src/lib/server/cowork/research-notice.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'stubs', setup(context) {
    const stubs = {
      '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>globalThis.__notice.client;',
      './access': 'export const requireCoworkWorkerAccess=async()=>{};',
    };
    context.onResolve({ filter: /.*/ }, input => stubs[input.path] ? { path: input.path, namespace: 'stub' } : undefined);
    context.onLoad({ filter: /.*/, namespace: 'stub' }, input => ({ contents: stubs[input.path] }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { processCoworkResearchNotices, coworkResearchNoticeRequestId, readCoworkResearchProgress } = loaded.exports;

const run = (n, status, parent, extra = {}) => db.cowork_runs.push({ id: id(n), user_id: U, organization_id: O, status, mode: 'approval', parent_run_id: parent ? id(parent) : null,
  request_id: id(1000 + n), message: `turno ${n}`, created_at: minutes(n), ...extra });
const research = (n, origin, lead, status, minute) => db.lead_research_jobs.push({ id: id(5000 + n), user_id: U, organization_id: O, status, error_code: null,
  created_at: minutes(minute), request_idempotency_key: `cowork:${id(origin)}:lead:${id(lead)}:research-v1` });
const pass = now => processCoworkResearchNotices({ client, force: true, now: new Date(base + now * 60_000) });

// A conversation: the request (1), the approval that started two research jobs (2), the turn after it (3, the newest).
run(1, 'completed', null); run(2, 'completed', 1); run(3, 'completed', 2);
db.leads.push({ id: id(201), user_id: U, organization_id: O, name: 'Rafael Durán', company: 'R&D Montajes' },
  { id: id(202), user_id: U, organization_id: O, name: 'Susana Cáceres', company: 'MSTI' });
research(1, 2, 201, 'completed', 4); research(2, 2, 202, 'running', 4);

// One of two still running, 5 minutes in: nothing yet.
assert.deepEqual(await pass(9), { notified: 0 });
assert.equal(admitted.length, 0);
assert.equal(db.cowork_run_events.length, 0);

// The live card of the conversation sees both from its newest turn.
const progress = await readCoworkResearchProgress(client, { userId: U, organizationId: O }, id(3), new Date(base + 9 * 60_000));
assert.deepEqual(progress.map(item => [item.name, item.status]).sort(), [['Rafael Durán', 'completed'], ['Susana Cáceres', 'running']]);

// Both finished: one notice after the newest turn, a fresh start, marked on the turn that started the research.
db.lead_research_jobs[1].status = 'partial';
assert.deepEqual(await pass(10), { notified: 1 });
assert.equal(admitted.length, 1);
assert.equal(admitted[0].p_parent_run_id, id(3));
assert.equal(admitted[0].p_request_id, coworkResearchNoticeRequestId(id(3)));
assert.equal(admitted[0].p_reset_depth, true);
assert.equal(admitted[0].p_mode, 'approval');
assert.match(admitted[0].p_message, /^Terminaron las investigaciones que pediste/);
assert.match(admitted[0].p_message, /Rafael Durán \(R&D Montajes\), leadId [0-9a-f-]+: lista\./);
assert.match(admitted[0].p_message, /Susana Cáceres \(MSTI\), leadId [0-9a-f-]+: lista, con vacíos\./);
assert.deepEqual(db.cowork_run_events.map(event => [event.run_id, event.kind, event.payload.jobIds.length]), [[id(2), 'research.notified', 2]]);

// Told once: the next minutes add nothing.
assert.deepEqual(await pass(11), { notified: 0 });
assert.equal(admitted.length, 1);

// A second request in the same conversation while its newest turn is working: wait, then go after it.
const notice = db.cowork_runs.at(-1);
research(3, 3, 201, 'completed', 12);
assert.deepEqual(await pass(13), { notified: 0 }, 'the notice turn is still queued');
notice.status = 'completed';
assert.deepEqual(await pass(14), { notified: 1 });
assert.equal(admitted[1].p_parent_run_id, notice.id);
assert.match(admitted[1].p_message, /^Terminó la investigación/);

// After 10 minutes the finished ones are told; the rest when they finish, in their own notice.
db.cowork_runs.at(-1).status = 'completed';
run(20, 'completed', null); run(21, 'completed', 20);
research(4, 21, 201, 'completed', 30); research(5, 21, 202, 'running', 30);
assert.deepEqual(await pass(35), { notified: 0 });
assert.deepEqual(await pass(41), { notified: 1 });
assert.match(admitted[2].p_message, /Sigue en curso: Susana Cáceres \(MSTI\)\. Te aviso aquí cuando termine\./);
assert.equal(admitted[2].p_parent_run_id, id(21));
db.cowork_runs.at(-1).status = 'completed';
db.lead_research_jobs.at(-1).status = 'completed';
assert.deepEqual(await pass(42), { notified: 1 });
assert.match(admitted[3].p_message, /Susana Cáceres/);
assert.doesNotMatch(admitted[3].p_message, /Rafael/);

// A last turn that failed: the notice goes after the newest turn that finished.
run(30, 'completed', null); run(31, 'failed', 30);
research(6, 30, 201, 'insufficient_data', 50);
assert.deepEqual(await pass(51), { notified: 1 });
assert.equal(admitted[4].p_parent_run_id, id(30));
assert.match(admitted[4].p_message, /sin datos suficientes para un informe/);

// Marked but not admitted (the admission failed): admitted on a later minute while its place is still the end.
run(40, 'completed', null);
research(7, 40, 202, 'completed', 60);
failures.admit = 1;
assert.deepEqual(await pass(61), { notified: 0 });
assert.equal(db.cowork_run_events.at(-1).run_id, id(40));
assert.deepEqual(await pass(62), { notified: 1 }, 'recovered');
assert.equal(admitted.at(-1).p_parent_run_id, id(40));
assert.deepEqual(await pass(63), { notified: 0 }, 'and never twice');

// Without its marker written, nothing is admitted: never a notice that could be told twice.
run(50, 'completed', null);
research(8, 50, 201, 'completed', 70);
failures.markers = 1;
const before = admitted.length;
assert.deepEqual(await pass(71), { notified: 0 });
assert.equal(admitted.length, before);
assert.deepEqual(await pass(72), { notified: 1 });

// A contact of «Por escribir» (Plan 6, PR-C1): the notice names them from enriched_leads, and asks for the whole report.
run(60, 'completed', null);
db.enriched_leads.push({ id: id(203), user_id: U, organization_id: O, full_name: 'Marcela Rojas', company_name: null, organization_name: 'Acme Ltda.' },
  { id: id(204), user_id: 'someone-else', organization_id: O, full_name: 'Ajena', company_name: 'Otra' });
research(10, 60, 203, 'completed', 74);
assert.deepEqual(await pass(75), { notified: 1 });
assert.match(admitted.at(-1).p_message, /Marcela Rojas \(Acme Ltda\.\), leadId [0-9a-f-]+: lista\./);
assert.match(admitted.at(-1).p_message, /entrégalos completos en document/);
assert.doesNotMatch(admitted.at(-1).p_message, /pocas líneas/);

// Research started outside Cowork is never told to a conversation; and one pass every 20 seconds at most.
db.lead_research_jobs.push({ id: id(9000), user_id: U, organization_id: O, status: 'completed', error_code: null, created_at: minutes(80), request_idempotency_key: `manual:${id(50)}` });
assert.deepEqual(await pass(81), { notified: 0 });
assert.deepEqual(await processCoworkResearchNotices({ client, now: new Date(base + 81 * 60_000 + 5_000) }), { notified: 0 });

console.log('PASS: research notices wait for the request or 10 minutes, go after the newest finished turn, are marked before admission, recovered once and never told twice, name contacts of «Por escribir» and ask for the whole report; the live card reads the conversation.');
