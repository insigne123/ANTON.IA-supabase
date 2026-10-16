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
