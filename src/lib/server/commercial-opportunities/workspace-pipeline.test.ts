import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The automatic moves with the database in memory: forward only, with the revision check and a line in the activity.
async function load() {
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-pipeline';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^\.\/(workspace-store|workspace-ai)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path === './workspace-ai'
        ? 'export async function opportunityGenerate(){ throw new Error("no model") }'
        : 'export function opportunityDb(r){ if (r && r.error) throw r.error; return r ? r.data : null } export async function addOpportunityActivity(c,s,id,kind,body,data){ globalThis.__activity.push({ kind, body, data }) }' }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

function db(work: { state: string; revision: number } | null, raceLost = false) {
  const updates: Array<Record<string, unknown>> = [];
  return { updates, client: { from: () => {
    let updating: Record<string, unknown> | null = null;
    const chain: any = { select: () => chain, eq: () => chain, update: (values: Record<string, unknown>) => { updating = values; updates.push(values); return chain; },
      maybeSingle: async () => ({ data: updating ? (raceLost ? null : { revision: (work?.revision ?? 0) + 1 }) : work, error: null }) };
    return chain;
  } } };
}
const scope = { organizationId: 'org', userId: 'u1' };

test('a report ready moves an assigned opportunity into preparation, once, and says so', async () => {
  const { applyAutomaticMove } = await load();
  (globalThis as any).__activity = [];
  const { client, updates } = db({ state: 'assigned', revision: 3 });
  assert.equal(await applyAutomaticMove(client, scope, 'op', { kind: 'report_ready' }), 'working');
  assert.equal(updates[0].state, 'working'); assert.equal(updates[0].revision, 4);
  assert.deepEqual((globalThis as any).__activity[0], { kind: 'auto_state', body: 'Pasó a «En preparación» automáticamente: el informe quedó listo.', data: { from: 'assigned', to: 'working' } });
});

test('ticking the step to submit moves it to «Presentada»; a closed stage or a lost race is left alone', async () => {
  const { applyAutomaticMove } = await load();
  (globalThis as any).__activity = [];
  const working = db({ state: 'working', revision: 7 });
  assert.equal(await applyAutomaticMove(working.client, scope, 'op', { kind: 'marked_done', routeKind: 'submit', label: 'Subir la oferta' }), 'submitted');
  const won = db({ state: 'won', revision: 9 });
  assert.equal(await applyAutomaticMove(won.client, scope, 'op', { kind: 'marked_done', routeKind: 'submit', label: 'Subir la oferta' }), null);
  assert.equal(won.updates.length, 0);
  const race = db({ state: 'assigned', revision: 2 }, true);
  assert.equal(await applyAutomaticMove(race.client, scope, 'op', { kind: 'task_started' }), null, 'a person changed it first');
  assert.equal((globalThis as any).__activity.length, 1);
});

// The pipeline's reads, recorded: every filter the page asked for reaches each query.
function recorder() {
  const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const client = { from(table: string) {
    const query = { table, calls: [] as Array<[string, unknown[]]> };
    queries.push(query);
    const result = () => {
      if (table === 'opportunity_work') return { data: [{ opportunity_id: 'w1', state: 'working' }], error: null };
      const head = query.calls.some(([name, args]) => name === 'select' && (args[1] as { head?: boolean } | undefined)?.head);
      return head ? { data: null, error: null, count: 7 } : { data: [{ id: `${table}-${queries.length}`, data: { evaluation: 'recommended', summary: { text: 'Listo.' } } }], error: null };
    };
    const chain: any = new Proxy({}, { get(_, name) {
      if (name === 'then') return (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
      if (name === 'maybeSingle') return async () => ({ data: null, error: null });
      return (...args: unknown[]) => { query.calls.push([String(name), args]); return chain; };
    } });
    return chain;
  } };
  return { client, queries };
}

test('the pipeline reads only the sources and words asked for, as many as the page asked, and counts the ones left out', async () => {
  const { readOpportunityPipeline } = await load();
  const { client, queries } = recorder();
  const result = await readOpportunityPipeline(client, scope, { kinds: ['hiring', 'linkedin_post'], query: 'aseo, (hospital)*', limits: { recommended: 120, found: 60 } });
  const opportunities = queries.filter(q => q.table === 'commercial_opportunities');
  assert.equal(opportunities.length, 6, 'the worked ones, two pages and three counts: the left-out ones are only counted');
  for (const q of opportunities) assert.ok(q.calls.some(([name, args]) => name === 'in' && args[0] === 'kind' && JSON.stringify(args[1]) === '["hiring","linkedin_post"]'), 'every read keeps the source');
  const ors = opportunities.flatMap(q => q.calls.filter(([name]) => name === 'or').map(([, args]) => String(args[0])));
  assert.ok(ors.every(or => or.includes('title.ilike.*aseo hospital*') && or.includes('buyer_name.ilike.*aseo hospital*')), 'the words, without what would break the filter');
  assert.ok(ors.filter(or => or.startsWith('and(or(deadline_at.is.null,deadline_at.gt.')).length === 5, 'still open and searched, in one «or» per read');
  const ranges = opportunities.flatMap(q => q.calls.filter(([name]) => name === 'range').map(([, args]) => args));
  assert.deepEqual(ranges, [[0, 119], [0, 59]]);
  assert.deepEqual(result.limits, { found: 60, recommended: 120, excluded: 0 });
  assert.equal(result.totals.excluded, 7);
});

test('without a search the pipeline keeps its plain filter of open opportunities', async () => {
  const { readOpportunityPipeline } = await load();
  const { client, queries } = recorder();
  await readOpportunityPipeline(client, scope);
  const ors = queries.filter(q => q.table === 'commercial_opportunities').flatMap(q => q.calls.filter(([name]) => name === 'or').map(([, args]) => String(args[0])));
  assert.ok(ors.length && ors.every(or => or.startsWith('deadline_at.is.null,deadline_at.gt.')));
  assert.ok(!queries.some(q => q.calls.some(([name, args]) => name === 'in' && args[0] === 'kind')), 'every source');
});
