import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The numbers beside «Conversaciones», «Cowork» and «Oportunidades» in the menu (APP-23), with the reads in memory.
async function load(entry: string, stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

const world: { replies: any[]; repliesFail: boolean; cowork: boolean; runs: any[]; hidden: string[]; opportunities: any; asked: string[] } = {
  replies: [], repliesFail: false, cowork: true, runs: [], hidden: [], opportunities: null, asked: [],
};
(globalThis as any).__nav = world;

const loaded = load(`export { readNavPending } from './src/lib/server/nav-pending';`, {
  '/cowork/runs': `export async function listCoworkRuns(auth, { hiddenRootIds }) { globalThis.__nav.asked.push('runs:' + hiddenRootIds.join(',')); return globalThis.__nav.runs.filter(run => !hiddenRootIds.includes(run.root_run_id)) }`,
  '/cowork/thread-settings': `export async function readCoworkThreadSettings() { return { hiddenRootIds: globalThis.__nav.hidden } }`,
  './home-opportunities': `export async function readHomeOpportunities() { const value = globalThis.__nav.opportunities; if (value instanceof Error) throw value; return value }`,
});

const supabase = {
  rpc: async (name: string) => ({ data: name === 'cowork_has_access' ? world.cowork : null, error: null }),
  from: () => {
    const chain: any = {
      select: () => chain, eq: () => chain, not: () => chain, order: () => chain, limit: () => chain,
      then: (resolve: (value: unknown) => void) => resolve(world.repliesFail ? { data: null, error: new Error('down') } : { data: world.replies, error: null }),
    };
    return chain;
  },
};
const scope = () => ({ supabase: supabase as any, admin: {} as any, user: { id: 'u1' }, organizationId: 'org-1', now: new Date('2026-10-24T15:00:00Z') });
const run = (id: string, root: string, status: string, at: string) => ({ id, root_run_id: root, parent_run_id: id === root ? null : root, status, created_at: at, message: 'Hola', automatic: false });

test('each section counts what waits for the person there', async () => {
  const { readNavPending } = await loaded;
  world.replies = [
    { id: '1', email: 'ana@cliente.cl', replied_at: '2026-10-23T10:00:00Z', reply_intent: 'positive' },
    { id: '2', email: 'ana@cliente.cl', replied_at: '2026-10-24T10:00:00Z', reply_intent: 'positive' },
    { id: '3', email: 'bruno@cliente.cl', replied_at: '2026-10-24T11:00:00Z', reply_intent: 'unsubscribe' },
  ];
  world.repliesFail = false; world.cowork = true; world.hidden = ['r3'];
  world.runs = [
    run('r1', 'r1', 'completed', '2026-10-20T10:00:00Z'), run('r1b', 'r1', 'waiting_approval', '2026-10-20T11:00:00Z'),
    // A proposal that the next message replaced: the conversation no longer waits.
    run('r2', 'r2', 'waiting_approval', '2026-10-21T10:00:00Z'), run('r2b', 'r2', 'completed', '2026-10-21T11:00:00Z'),
    run('r3', 'r3', 'waiting_approval', '2026-10-22T10:00:00Z'),
  ];
  world.opportunities = { attention: 3 };
  assert.deepEqual(await readNavPending(scope()), { conversations: 1, cowork: 1, opportunities: 3 });
  assert.deepEqual(world.asked, ['runs:r3'], 'a deleted conversation does not count');
});

test('without access, or when a read fails, that number stays out', async () => {
  const { readNavPending } = await loaded;
  world.repliesFail = true; world.cowork = false; world.opportunities = null;
  assert.deepEqual(await readNavPending(scope()), { conversations: null, cowork: null, opportunities: null });
  world.opportunities = new Error('down');
  assert.equal((await readNavPending(scope())).opportunities, null);
});
