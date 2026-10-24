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

// The pipeline's reads, recorded: each stage is a page of opportunity_workspace_page with every filter the page asked for, and the
// numbers come from opportunity_workspace_counts.
function recorder(options: { pages?: (args: any) => unknown[]; counts?: unknown[]; tables?: Record<string, unknown[] | { error: unknown }> } = {}) {
  const calls: Array<[string, any]> = [];
  const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const client = {
    rpc: async (name: string, args: any) => {
      calls.push([name, args]);
      if (name === 'opportunity_workspace_counts') return { data: options.counts ?? [], error: null };
      return { data: options.pages ? options.pages(args) : [], error: null };
    },
    from(table: string) {
      const query = { table, calls: [] as Array<[string, unknown[]]> };
      queries.push(query);
      const answer = () => {
        const given = options.tables?.[table];
        if (given && !Array.isArray(given)) return { data: null, ...given };
        if (table === 'opportunity_work') {
          const ids = (query.calls.find(([name, args]) => name === 'in' && args[0] === 'opportunity_id')?.[1][1] ?? []) as string[];
          return { data: ids.map(id => ({ opportunity_id: id, state: 'working', revision: 2 })), error: null };
        }
        return { data: given ?? [], error: null };
      };
      const chain: any = new Proxy({}, { get(_, name) {
        if (name === 'then') return (resolve: any, reject: any) => Promise.resolve(answer()).then(resolve, reject);
        if (name === 'maybeSingle') return async () => ({ data: null, error: null });
        return (...args: unknown[]) => { query.calls.push([String(name), args]); return chain; };
      } });
      return chain;
    },
  };
  const pages = () => calls.filter(([name]) => name === 'opportunity_workspace_page').map(([, args]) => args);
  return { client, calls, queries, pages };
}
const stageOf = (args: any) => `${args.p_stages.join('+')}${args.p_evaluations.length ? `/${args.p_evaluations.join('+')}` : ''}`;

test('the pipeline asks for each stage with the sources, words and lines of service asked for, as many as the page asked for', async () => {
  const { readOpportunityPipeline } = await load();
  const { client, pages, calls } = recorder();
  const result = await readOpportunityPipeline(client, scope, { kinds: ['hiring', 'linkedin_post'], query: ' aseo, (hospital)* ', categories: ['seguridad'], limits: { recommended: 120, found: 60 } });
  assert.deepEqual(pages().map(stageOf), ['assigned+working+blocked+submitted+won', 'open/recommended', 'open/review+pending', 'open/recommended'],
    'the stages in play whole, then the two pages of what nobody works yet and the recommended closing first; what the AI left out, the lost and the archived wait to be opened');
  assert.deepEqual(pages().map(args => args.p_limit), [600, 120, 60, 20]);
  for (const args of [...pages(), calls.find(([name]) => name === 'opportunity_workspace_counts')![1]]) {
    assert.deepEqual([args.p_org, args.p_user, args.p_kinds, args.p_query, args.p_biddable], ['org', 'u1', ['hiring', 'linkedin_post'], 'aseo, (hospital)*', true], 'every read keeps the filters');
    assert.ok(args.p_terms.includes('guardia'), 'and the words of the line of service');
  }
  assert.deepEqual(result.limits, { found: 60, recommended: 120, excluded: 0, lost: 0, archived: 0 });
});

test('what the AI left out, the lost and the archived load when someone opens them, the last moved first', async () => {
  const { readOpportunityPipeline } = await load();
  const { client, pages } = recorder();
  await readOpportunityPipeline(client, scope, { limits: { excluded: 60, lost: 60, archived: 120 } });
  const opened = pages().filter(args => ['open/excluded', 'lost', 'archived'].includes(stageOf(args)));
  assert.deepEqual(opened.map(args => [stageOf(args), args.p_limit, args.p_sort]), [['open/excluded', 60, 'priority'], ['lost', 60, 'recent'], ['archived', 120, 'recent']]);
});

test('the numbers of each stage come from the counts of the database, whatever the pages loaded', async () => {
  const { readOpportunityPipeline } = await load();
  const { client } = recorder({ counts: [{ stage: 'open', evaluation: 'review', total: 1200 }, { stage: 'open', evaluation: 'pending', total: '30' }, { stage: 'open', evaluation: 'recommended', total: 55 },
    { stage: 'open', evaluation: 'excluded', total: 3700 }, { stage: 'archived', evaluation: 'review', total: 12 }, { stage: 'archived', evaluation: 'recommended', total: 2 }, { stage: 'lost', evaluation: null, total: 1 }] });
  const result = await readOpportunityPipeline(client, scope);
  assert.deepEqual(result.totals, { found: 1230, recommended: 55, excluded: 3700, lost: 1, archived: 14 });
});

test('each page is the best scored first by default, or the soonest to close, or the largest; the stages in play always whole', async () => {
  const { readOpportunityPipeline } = await load();
  const sorts = async (sort?: string) => {
    const { client, pages } = recorder();
    const result = await readOpportunityPipeline(client, scope, { sort: sort as any });
    return { result, sorts: pages().map(args => args.p_sort) };
  };
  // The last read is «Cierran esta semana», always the soonest to close.
  assert.deepEqual((await sorts()).sorts, ['priority', 'priority', 'priority', 'deadline']);
  const soonest = await sorts('deadline');
  assert.deepEqual(soonest.sorts, ['priority', 'deadline', 'deadline', 'deadline']);
  assert.equal(soonest.result.sort, 'deadline');
  assert.deepEqual((await sorts('amount')).sorts, ['priority', 'amount', 'amount', 'deadline']);
  assert.deepEqual((await sorts('cheapest')).sorts, ['priority', 'priority', 'priority', 'deadline'], 'an unknown order is the default one');
});

test('the work records of the worked cards are read a hundred ids at a time, and only theirs', async () => {
  const { readOpportunityPipeline } = await load();
  const worked = Array.from({ length: 250 }, (_, index) => ({ id: `w${index}`, data: { evaluation: 'recommended', summary: { text: 'Listo.' } } }));
  const { client, queries } = recorder({ pages: args => stageOf(args).startsWith('assigned') ? worked : [{ id: `open-${stageOf(args)}`, data: { evaluation: 'review', summary: { text: 'Listo.' } } }] });
  const result = await readOpportunityPipeline(client, scope);
  const reads = queries.filter(query => query.table === 'opportunity_work');
  assert.deepEqual(reads.map(query => (query.calls.find(([name]) => name === 'in')![1][1] as string[]).length), [100, 100, 50]);
  assert.equal(result.work.length, 250);
  assert.equal(result.items.length, 252, 'the worked ones and the two open pages');
});

test('each card of the pipeline comes with what its research and its report are doing, and a failure to read that never stops the pipeline', async () => {
  const { readOpportunityPipeline } = await load();
  const rows = [{ id: 'a', data: { evaluation: 'recommended', summary: { text: 'Listo.' } } }, { id: 'b', data: { evaluation: 'review', summary: { text: 'Listo.' } } }];
  const { client, queries } = recorder({ pages: args => stageOf(args) === 'open/recommended' ? [rows[0]] : stageOf(args) === 'open/review+pending' ? [rows[1]] : [],
    tables: { opportunity_jobs: [{ opportunity_id: 'a', state: 'running', updated_at: '2026-10-21T14:58:00Z' }, { opportunity_id: 'nobody', state: 'running', updated_at: '2026-10-21T14:59:00Z' }],
      opportunity_reports: [{ opportunity_id: 'b', created_at: '2026-10-21T12:00:00Z' }] } });
  const result = await readOpportunityPipeline(client, scope);
  assert.deepEqual(result.progress, { a: { research: 'running', researchAt: '2026-10-21T14:58:00Z' }, b: { reportAt: '2026-10-21T12:00:00Z' } }, 'only for the cards shown');
  const jobs = queries.find(q => q.table === 'opportunity_jobs' && q.calls.some(([name, args]) => name === 'eq' && args[0] === 'kind' && args[1] === 'research'))!;
  assert.ok(jobs.calls.some(([name, args]) => name === 'eq' && args[0] === 'organization_id'), 'only the workspace\'s own');
  assert.ok(jobs.calls.some(([name, args]) => name === 'limit' && args[0] === 600), 'a bounded read');
  // The read failing leaves the cards as they were.
  const failing = recorder({ pages: () => rows, tables: { opportunity_jobs: { error: { message: 'down' } } } });
  assert.deepEqual((await readOpportunityPipeline(failing.client, scope)).progress, {});
});

test('«Cierran esta semana»: what closes within seven days and someone can still act on, across the stages, the soonest first', async () => {
  const { closingThisWeek, readOpportunityPipeline } = await load();
  const now = Date.parse('2026-10-27T15:00:00Z');
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const inPlay = [{ id: 'w1', title: 'Aseo  Hospital', deadline_at: at(2) }, { id: 'w2', title: 'Ya presentada', deadline_at: at(1) }, { id: 'w3', title: 'Bloqueada', deadline_at: at(0.5) },
    { id: 'w4', title: 'Lejos', deadline_at: at(9) }, { id: 'w5', title: 'Cerró', deadline_at: at(-1) }];
  const work = [{ opportunity_id: 'w1', state: 'working' }, { opportunity_id: 'w2', state: 'submitted' }, { opportunity_id: 'w3', state: 'blocked' }, { opportunity_id: 'w4', state: 'assigned' }, { opportunity_id: 'w5', state: 'assigned' }];
  const recommended = [{ id: 'r1', title: 'Guardias Temuco', deadline_at: at(4) }, { id: 'r2', title: 'Sin fecha', deadline_at: null }, { id: 'w1', title: 'Aseo  Hospital', deadline_at: at(2) }];
  assert.deepEqual(closingThisWeek(inPlay, recommended, work, now).map((item: any) => [item.id, item.stage, item.title]),
    [['w3', 'blocked', 'Bloqueada'], ['w1', 'working', 'Aseo Hospital'], ['r1', 'recommended', 'Guardias Temuco']], 'presented, far, closed and dateless ones stay out; each one once');
  const many = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, title: `R${index}`, deadline_at: at(1 + index / 10) }));
  assert.equal(closingThisWeek([], many, [], now).length, 12);
  // On the pipeline: from the page of the recommended ones closing first.
  const { client } = recorder({ pages: args => args.p_sort === 'deadline' && args.p_limit === 20 ? [{ id: 'soon', title: 'Pronto', deadline_at: new Date(Date.now() + 86_400_000).toISOString() }] : [] });
  assert.deepEqual((await readOpportunityPipeline(client, scope)).week.map((item: any) => [item.id, item.stage]), [['soon', 'recommended']]);
});
