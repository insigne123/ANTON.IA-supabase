import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The sources of the radar with Mercado Público, Apify and the database in memory: what each search asks for.
async function load(stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: `export { captureOpportunityLinkedIn, captureOpportunityTenders } from './src/lib/server/commercial-opportunities/workspace-sources';`, loader: 'ts', resolveDir: process.cwd() },
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

const STUBS = {
  '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
  './workspace-ai': 'export async function opportunityGenerate(){ throw new Error("no model here") }',
  './workspace-store': 'export function opportunityDb(result){ if (result && result.error) throw result.error; return result ? result.data : null }',
  './tickets': 'export async function resolveTicketForOrganization(){ return { ticket: "t" } }',
  './mercado-publico': 'export async function listOpenLicitaciones(){ return [] }',
  './compra-agil': `export class CompraAgilError extends Error { constructor(message, retryable){ super(message); this.retryable = retryable } }
    globalThis.__CompraAgilError = CompraAgilError;
    export function compraAgilQuery(keyword){ return keyword }
    export async function searchCompraAgil(){ throw globalThis.__compraAgil }`,
};

// A client that answers each table with what the test puts in `rows`, and remembers the RPCs.
function memoryClient(rows: Record<string, unknown>) {
  const rpcs: Array<[string, any]> = [];
  return {
    rpcs,
    rpc: async (name: string, args: unknown) => { rpcs.push([name, args]); return { data: name === 'opportunity_budget_reserve' ? { admitted: true, fresh: true, id: 'res-1' } : true, error: null }; },
    from: (table: string) => {
      const chain: any = {
        select: () => chain, eq: () => chain, neq: () => chain, order: () => chain, limit: () => chain, insert: () => chain, upsert: () => chain, update: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }), single: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return chain;
    },
  };
}

test('a busy Mercado Público ticket leaves the keyword search waiting for a later turn, not failed', async () => {
  const { captureOpportunityTenders } = await load(STUBS);
  const CompraAgilError = (globalThis as any).__CompraAgilError;
  const job = { id: 'j1', organization_id: 'org', requested_by: 'u1', kind: 'tenders', dedupe_key: 'k', lease_token: 'l', state: 'running', attempts: 1, payload: { keyword: 'aseo', revision: 1 } };
  (globalThis as any).__compraAgil = new CompraAgilError('Compra Ágil no aceptó más consultas del ticket por ahora (429).', true);
  const first = await captureOpportunityTenders(memoryClient({}) as any, job as any, { revision: 1 });
  assert.equal(first.waiting, true);
  assert.equal(first.retry.tries, 1);
  assert.ok(Math.abs(Date.parse(first.retry.nextAt) - Date.now() - 60_000) < 5_000, 'the next try in a minute');
  // Taken again before its time, it waits without calling Mercado Público.
  (globalThis as any).__compraAgil = new Error('must not call');
  assert.deepEqual(await captureOpportunityTenders(memoryClient({}) as any, { ...job, result: first } as any, { revision: 1 }), { waiting: true, retry: first.retry });
  // Each try waits longer: the fourth, eight minutes.
  (globalThis as any).__compraAgil = new CompraAgilError('Compra Ágil respondió 504 (falla de Mercado Público).', true);
  const third = { waiting: true, retry: { tries: 3, nextAt: new Date(Date.now() - 1000).toISOString() } };
  const fourth = await captureOpportunityTenders(memoryClient({}) as any, { ...job, result: third } as any, { revision: 1 });
  assert.equal(fourth.retry.tries, 4);
  assert.ok(Math.abs(Date.parse(fourth.retry.nextAt) - Date.now() - 8 * 60_000) < 5_000);
  // After six tries it is reported, with the reason a person can read.
  const sixth = { waiting: true, retry: { tries: 6, nextAt: new Date(Date.now() - 1000).toISOString() } };
  await assert.rejects(captureOpportunityTenders(memoryClient({}) as any, { ...job, result: sixth } as any, { revision: 1 }), (error: any) => error.status === 503 && /504/.test(error.message));
  // A rejected ticket is not retried.
  (globalThis as any).__compraAgil = new CompraAgilError('Compra Ágil rechazó el ticket.', false);
  await assert.rejects(captureOpportunityTenders(memoryClient({}) as any, job as any, { revision: 1 }), /rechazó el ticket/);
});

test('LinkedIn searches ask for a week of ads after a pause, five post queries, and the larger budget', async () => {
  const { captureOpportunityLinkedIn } = await load(STUBS);
  const calls: Array<{ url: string; body: any }> = [];
  const realFetch = globalThis.fetch;
  process.env.APIFY_TOKEN = 'test';
  Object.assign(process.env, { OPPORTUNITIES_POST_USD_PER_ITEM: '0.002', OPPORTUNITIES_POST_START_USD: '0.00005', OPPORTUNITIES_POST_EMPTY_QUERY_USD: '0.001' });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ data: init?.method === 'POST' ? { id: 'run-1' } : { status: 'RUNNING' } }), { status: 200 });
  }) as typeof fetch;
  try {
    const context = { priority: 'hiring', territories: [], criteria: { roles: ['bodeguero', 'conductor'], postQueries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] } };
    const job = { id: 'j2', organization_id: 'org', requested_by: 'u1', kind: 'hiring', lease_token: 'l', payload: {} };
    assert.deepEqual(await captureOpportunityLinkedIn(memoryClient({ opportunity_jobs: null }) as any, job as any, context), { waiting: true });
    const ads = calls[0];
    assert.match(ads.url, /fantastic-jobs~advanced-linkedin-job-search-api\/runs\?maxTotalChargeUsd=0\.4&/);
    assert.deepEqual([ads.body.timeRange, ads.body.limit, ads.body.locationSearch], ['7d', 78, ['Chile']]);

    calls.length = 0;
    const recent = new Date(Date.now() - 3 * 3_600_000).toISOString();
    await captureOpportunityLinkedIn(memoryClient({ opportunity_jobs: { updated_at: recent } }) as any, { ...job, kind: 'posts' } as any, context);
    const posts = calls[0];
    assert.match(posts.url, /harvestapi~linkedin-post-search\/runs\?maxTotalChargeUsd=0\.15&/);
    assert.deepEqual([posts.body.searchQueries, posts.body.maxPosts, posts.body.postedLimit], [['q1', 'q2', 'q3', 'q4', 'q5'], 14, 'week']);
  } finally {
    globalThis.fetch = realFetch;
    for (const name of ['APIFY_TOKEN', 'OPPORTUNITIES_POST_USD_PER_ITEM', 'OPPORTUNITIES_POST_START_USD', 'OPPORTUNITIES_POST_EMPTY_QUERY_USD']) delete process.env[name];
  }
});

test('the tenders job runs the listing and Compra Ágil only when each is on in «Qué buscamos»', async () => {
  const { captureOpportunityTenders } = await load({ ...STUBS, './mercado-publico': 'export async function listOpenLicitaciones(){ globalThis.__listed = (globalThis.__listed || 0) + 1; return [] }' });
  const upserts: unknown[] = [];
  const client = (() => { const base: any = memoryClient({}); const from = base.from; base.from = (table: string) => { const chain = from(table); chain.upsert = (row: unknown) => { if (table === 'opportunity_jobs') upserts.push(row); return chain; }; return chain; }; return base; })();
  const job = { id: 'j3', organization_id: 'org', requested_by: 'u1', kind: 'tenders', dedupe_key: 'daily:2026-10-24:1:tenders', lease_token: 'l', state: 'running', attempts: 1, payload: { revision: 1 } };
  const context = { revision: 1, criteria: { keywords: ['aseo', 'guardias'] } };
  (globalThis as any).__listed = 0;
  const off = await captureOpportunityTenders(client, job as any, { ...context, search: { sources: { tenders: false } } });
  assert.equal((globalThis as any).__listed, 0, 'the listing is off');
  assert.equal(off.coverage, 'compra_agil_only');
  assert.ok(upserts.length > 0, 'Compra Ágil still searches the words of the day');
  upserts.length = 0;
  await captureOpportunityTenders(client, job as any, { ...context, search: { sources: { compraAgil: false } } });
  assert.equal((globalThis as any).__listed, 1);
  assert.equal(upserts.length, 0, 'no Compra Ágil searches');
});
