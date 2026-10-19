import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The summaries of the pipeline with the database, Mercado Público and the model in memory.
async function load() {
  const stubs: Record<string, string> = {
    './workspace-store': 'export function opportunityDb(result){ if (result.error) throw result.error; return result.data }',
    './workspace-ai': 'export async function opportunityGenerate(client, job, input){ (globalThis.__calls ||= []).push(input); return globalThis.__answer(input) }',
    './tickets': 'export async function resolveTicketForOrganization(){ return globalThis.__ticket === undefined ? { ticket: "t" } : globalThis.__ticket }',
    './mercado-publico': 'export async function getLicitacion(){ throw new Error("use dependencies") } export const isMercadoPublicoBusy = error => Boolean(error && error.busy)',
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-summaries';`, loader: 'ts', resolveDir: process.cwd() },
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

/** The tables in memory, with the filters the module uses (JSON paths included). */
function memory(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = { opportunity_jobs: [], opportunity_work: [], commercial_opportunities: [], ...seed };
  const read = (row: any, path: string) => {
    const [column, ...rest] = path.split(/->>?/);
    let value = row[column];
    for (const key of rest) value = value == null ? undefined : value[key];
    return path.includes('->>') && value !== undefined && value !== null ? String(value) : value;
  };
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any } = { kind: 'select' }; let one = false; let limit = Infinity; let order: string | null = null;
    const run = () => {
      const rows = tables[name];
      if (action.kind === 'upsert') {
        const clash = rows.find(row => row.organization_id === action.values.organization_id && row.dedupe_key === action.values.dedupe_key);
        if (!clash) rows.push({ id: `job-${rows.length + 1}`, state: 'queued', updated_at: new Date().toISOString(), ...action.values });
        return { data: null, error: null };
      }
      let found = rows.filter(row => filters.every(filter => filter(row)));
      if (action.kind === 'update') { found.forEach(row => Object.assign(row, action.values)); return { data: one ? (found[0] ? { updated_at: found[0].updated_at } : null) : found, error: null }; }
      if (order) found = [...found].sort((a, b) => b[order!] - a[order!]);
      found = found.slice(0, limit);
      // Copies, as the database returns them: a later change in the table does not reach what was read.
      return { data: structuredClone(one ? found[0] ?? null : found), error: null };
    };
    const chain: any = {
      select: () => chain, eq: (key: string, value: unknown) => { filters.push(row => read(row, key) === value); return chain; },
      neq: (key: string, value: unknown) => { filters.push(row => read(row, key) !== value); return chain; },
      gt: (key: string, value: any) => { filters.push(row => read(row, key) > value); return chain; },
      is: (key: string, value: unknown) => { filters.push(row => (read(row, key) ?? null) === value); return chain; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(read(row, key))); return chain; },
      or: () => chain, order: (key: string) => { order = key; return chain; }, limit: (count: number) => { limit = count; return chain; },
      maybeSingle: () => { one = true; return chain; },
      update: (values: any) => { action = { kind: 'update', values }; return chain; },
      upsert: (values: any) => { action = { kind: 'upsert', values }; return chain; },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  };
  return { tables, client: { from } };
}

const opportunity = (id: string, patch: Record<string, any> = {}) => ({ id, organization_id: 'org', kind: 'tender', title: `LICITACIÓN ${id}`, company_name: null, buyer_name: null,
  amount: null, currency: null, deadline_at: null, score: 50, updated_at: '2026-10-19T10:00:00Z', data: { evaluation: 'review', description: `LICITACIÓN ${id}`, observed: { code: `${id}-1-LP26` } }, ...patch });
const job = { id: 'job', organization_id: 'org', requested_by: 'admin', payload: { summaries: true }, kind: 'evaluate', state: 'running', lease_token: 'l', attempts: 1, opportunity_id: null, dedupe_key: 'summaries' };
const answer = (input: any) => ({ summaries: JSON.parse(input.prompt.slice(input.prompt.indexOf('['))).map((item: any) => ({ id: item.id, summary: `De qué trata ${item.nombre} (${item.organismoOEmpresa ?? 'sin organismo'})` })) });

test('a tender known by name reads its official file first: buyer, description and lines are saved, then its summary', async () => {
  const summaries = await load();
  const { tables, client } = memory({ commercial_opportunities: [opportunity('a')] });
  (globalThis as any).__answer = answer; (globalThis as any).__calls = []; delete (globalThis as any).__ticket;
  const asked: string[] = [];
  const result = await summaries.runOpportunitySummaries(client, job, Date.now(), {
    resolveTicket: async () => ({ ticket: 't' }),
    getLicitacion: async (code: string) => { asked.push(code); return { source: 'mercado_publico', code, name: 'LICITACIÓN a', description: 'Guardias para el recinto', buyer: 'Servicio Agrícola y Ganadero', buyerUnit: 'Aeropuerto',
      region: 'Región Metropolitana', amount: 48_000_000, currency: 'CLP', publishedAt: null, closesAt: null, status: 'publicada', items: [{ code: null, name: 'Guardias' }] }; },
  });
  assert.deepEqual(asked, ['a-1-LP26']);
  const row = tables.commercial_opportunities[0];
  assert.equal(row.buyer_name, 'Servicio Agrícola y Ganadero');
  assert.equal(row.amount, 48_000_000);
  assert.equal(row.data.description, 'Guardias para el recinto');
  assert.deepEqual(row.data.observed.items, [{ code: null, name: 'Guardias' }]);
  assert.equal(row.data.summary.text, 'De qué trata LICITACIÓN a (Servicio Agrícola y Ganadero).');
  assert.equal(row.data.summary.basis, 'ficha');
  assert.equal(row.data.summary.model, 'claude-haiku-5-5');
  assert.equal((globalThis as any).__calls[0].role, 'screen');
  assert.deepEqual({ waiting: result.waiting, summarized: result.summarized, detailed: result.detailed }, { waiting: false, summarized: 1, detailed: 1 });
});

test('a busy ticket leaves the tender for the next reading; one the model leaves out is not asked again; summarized ones are skipped', async () => {
  const summaries = await load();
  const { tables, client } = memory({ commercial_opportunities: [
    opportunity('busy'), opportunity('left', { kind: 'hiring', data: { evaluation: 'recommended', description: 'Guardia 4x4 · Santiago' }, score: 90 }),
    opportunity('done', { data: { evaluation: 'review', summary: { text: 'Ya resumida.' } } }), opportunity('closed', { data: { evaluation: 'excluded' } }),
  ] });
  (globalThis as any).__answer = () => ({ summaries: [] });
  const result = await summaries.runOpportunitySummaries(client, job, Date.now(), {
    resolveTicket: async () => ({ ticket: 't' }), getLicitacion: async () => { const error: any = new Error('busy'); error.busy = true; throw error; },
  });
  const byId = Object.fromEntries(tables.commercial_opportunities.map(row => [row.id, row]));
  assert.equal(byId.busy.data.summary, undefined, 'waits for its official file');
  assert.deepEqual({ text: byId.left.data.summary.text, basis: byId.left.data.summary.basis }, { text: '', basis: 'texto' });
  assert.equal(byId.done.data.summary.text, 'Ya resumida.');
  assert.equal(byId.closed.data.summary, undefined, 'excluded ones are not shown in the pipeline');
  assert.equal(result.waiting, true, 'the busy one is read on the next tick');
});

test('without a ticket the name is enough; a change made meanwhile is not overwritten', async () => {
  const summaries = await load();
  const { tables, client } = memory({ commercial_opportunities: [opportunity('a'), opportunity('b')] });
  (globalThis as any).__answer = (input: any) => { tables.commercial_opportunities[1].updated_at = '2026-10-19T11:00:00Z'; return answer(input); };
  await summaries.runOpportunitySummaries(client, job, Date.now(), { resolveTicket: async () => null, getLicitacion: async () => { throw new Error('not asked'); } });
  const [a, b] = tables.commercial_opportunities;
  assert.equal(a.data.summary.basis, 'nombre');
  assert.equal(a.buyer_name, null);
  assert.equal(b.data.summary, undefined, 'b changed while the model wrote: the next reading takes it');
});

test('a verdict the screening gives meanwhile, which keeps updated_at, is not overwritten with the one read', async () => {
  const summaries = await load();
  const { tables, client } = memory({ commercial_opportunities: [opportunity('a', { data: { evaluation: 'review', profileRevision: 3, description: 'Guardias para el recinto', observed: { code: 'a-1-LP26' } }, buyer_name: 'SAG' })] });
  (globalThis as any).__answer = (input: any) => { const row = tables.commercial_opportunities[0]; row.data = { ...row.data, evaluation: 'recommended', matchedService: 'Guardias' }; return answer(input); };
  await summaries.runOpportunitySummaries(client, job, Date.now(), { resolveTicket: async () => null, getLicitacion: async () => { throw new Error('not asked'); } });
  const [a] = tables.commercial_opportunities;
  assert.deepEqual({ evaluation: a.data.evaluation, matchedService: a.data.matchedService, summary: a.data.summary }, { evaluation: 'recommended', matchedService: 'Guardias', summary: undefined });
});

test('the pipeline queues one reading when cards lack their summary, and none while one is under way', async () => {
  const summaries = await load();
  const { tables, client } = memory({});
  const scope = { organizationId: 'org', userId: 'admin', role: 'admin' };
  assert.equal(await summaries.enqueueOpportunitySummaries(client, scope, [{ data: { summary: { text: 'x' } } }, { data: { summary: { text: '' } } }]), 0);
  assert.equal(tables.opportunity_jobs.length, 0);
  assert.equal(await summaries.enqueueOpportunitySummaries(client, scope, [{ id: 'x', data: {} }, { id: 'done', data: { summary: { text: 'y' } } }, { id: 'z', data: null }]), 2);
  assert.equal(tables.opportunity_jobs.length, 1);
  assert.deepEqual({ kind: tables.opportunity_jobs[0].kind, payload: tables.opportunity_jobs[0].payload }, { kind: 'evaluate', payload: { summaries: true, ids: ['x', 'z'] } });
  tables.opportunity_jobs[0].dedupe_key = 'summaries:earlier';
  await summaries.enqueueOpportunitySummaries(client, scope, [{ id: 'x', data: {} }]);
  assert.equal(tables.opportunity_jobs.length, 1, 'the queued one is still to run');
  // One that has not moved in 15 minutes (its attempts ran out) no longer holds back a new one.
  Object.assign(tables.opportunity_jobs[0], { state: 'waiting', updated_at: new Date(Date.now() - 16 * 60_000).toISOString() });
  await summaries.enqueueOpportunitySummaries(client, scope, [{ id: 'x', data: {} }]);
  assert.equal(tables.opportunity_jobs.length, 2);
});

test('the reading takes the cards the pipeline showed, in its order, and none it did not show', async () => {
  const summaries = await load();
  const { tables, client } = memory({ commercial_opportunities: [
    opportunity('high', { score: 95 }), opportunity('shown-last', { score: 10 }), opportunity('shown-first', { score: 40 }), opportunity('done', { data: { evaluation: 'review', summary: { text: 'Ya resumida.' } } }),
  ] });
  (globalThis as any).__answer = answer; (globalThis as any).__calls = [];
  const result = await summaries.runOpportunitySummaries(client, { ...job, payload: { summaries: true, ids: ['shown-first', 'done', 'shown-last'] } }, Date.now(),
    { resolveTicket: async () => null, getLicitacion: async () => { throw new Error('not asked'); } });
  const asked = JSON.parse((globalThis as any).__calls[0].prompt.slice((globalThis as any).__calls[0].prompt.indexOf('['))).map((item: any) => item.id);
  assert.deepEqual(asked, ['shown-first', 'shown-last']);
  const byId = Object.fromEntries(tables.commercial_opportunities.map(row => [row.id, row]));
  assert.equal(byId.high.data.summary, undefined, 'not on the pipeline the person saw');
  assert.equal(result.waiting, false);
});
