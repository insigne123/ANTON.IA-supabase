import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The «Asistente» of Oportunidades with the database and the model in memory: threads, what the model reads, the answer saved.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
    './workspace-access': 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(client, scope){ return globalThis.__readable ?? null }',
    './workspace-ai': 'export async function opportunityGenerate(client, job, options){ globalThis.__call = options; return globalThis.__reply(options) }',
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-assistant';`, loader: 'ts', resolveDir: process.cwd() },
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

/** Enough of supabase-js for these reads and writes; `missing` names tables that do not exist yet (before the migration). */
function memory(seed: Record<string, any[]> = {}, options: { list?: (args: any) => any[]; missing?: string[] } = {}) {
  let serial = 0; let clock = Date.parse('2026-10-18T12:00:00Z');
  const tables: Record<string, any[]> = { opportunity_assistant_threads: [], opportunity_assistant_messages: [], opportunity_jobs: [], opportunity_work: [],
    opportunity_company_context: [], opportunity_purchase_plan: [], opportunity_chat_messages: [], commercial_opportunities: [], organization_members: [],
    opportunity_tender_profile: [], opportunity_company_documents: [], ...seed };
  const rpcs: any[] = [];
  const defaults = (name: string) => {
    const at = new Date(clock += 1000).toISOString();
    return name === 'opportunity_jobs' ? { state: 'queued', error: null, created_at: at } : { created_at: at, updated_at: at, answer: null };
  };
  const query = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    const sorts: Array<{ key: string; ascending: boolean }> = [];
    let action: { kind: string; values?: any; conflict?: string[]; ignore?: boolean } = { kind: 'select' };
    const run = () => {
      if (options.missing?.includes(name)) return { data: null, error: { code: '42P01', message: 'missing' } };
      const match = (row: any) => filters.every(filter => filter(row));
      if (action.kind === 'insert') {
        const added = ([].concat(action.values) as any[]).map(value => ({ id: `${name.split('_').at(-1)}-${++serial}`, ...defaults(name), ...value }));
        tables[name].push(...added); return { data: added, error: null };
      }
      if (action.kind === 'upsert') {
        for (const value of [].concat(action.values) as any[]) {
          const index = tables[name].findIndex(row => action.conflict!.every(key => row[key] === value[key]));
          if (index >= 0 && action.ignore) continue;
          if (index >= 0) tables[name][index] = { ...tables[name][index], ...value };
          else tables[name].push({ id: `${name.split('_').at(-1)}-${++serial}`, ...defaults(name), ...value });
        }
        return { data: null, error: null };
      }
      if (action.kind === 'update') { tables[name] = tables[name].map(row => match(row) ? { ...row, ...action.values } : row); return { data: null, error: null }; }
      if (action.kind === 'delete') { tables[name] = tables[name].filter(row => !match(row)); return { data: null, error: null }; }
      const found = tables[name].filter(match);
      for (const sort of [...sorts].reverse()) found.sort((a, b) => (a[sort.key] < b[sort.key] ? -1 : a[sort.key] > b[sort.key] ? 1 : 0) * (sort.ascending ? 1 : -1));
      return { data: found, error: null };
    };
    const first = () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; };
    const builder: any = {
      select: () => builder, insert: (values: any) => { action = { kind: 'insert', values }; return builder; },
      upsert: (values: any, opts: any) => { action = { kind: 'upsert', values, conflict: String(opts.onConflict).split(','), ignore: Boolean(opts.ignoreDuplicates) }; return builder; },
      update: (values: any) => { action = { kind: 'update', values }; return builder; },
      delete: () => { action = { kind: 'delete' }; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return builder; },
      lt: (key: string, value: any) => { filters.push(row => row[key] < value); return builder; },
      not: (key: string, operator: string, value: unknown) => { filters.push(row => !(operator === 'is' && value === null ? row[key] === null || row[key] === undefined : row[key] === value)); return builder; },
      order: (key: string, opts?: { ascending?: boolean }) => { sorts.push({ key, ascending: opts?.ascending !== false }); return builder; },
      limit: () => builder,
      maybeSingle: async () => first(), single: async () => first(),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  const rpc = async (name: string, args: any) => {
    rpcs.push([name, args]);
    if (name === 'opportunity_workspace_list') return { data: options.list ? options.list(args) : [], error: null };
    return { data: null, error: null };
  };
  return { tables, rpcs, client: { from: query, rpc } as any };
}

const opportunity = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'tender', title, company_name: null, buyer_name: 'Municipalidad de Castro',
  company_domain: null, url: null, score: 80, reasons: ['Calza con aseo'], deadline_at: null, amount: null, currency: null, data: { evaluation: 'recommended' }, updated_at: '2026-10-17T00:00:00Z', ...extra });
const member = { organizationId: 'org', userId: 'u1', role: 'member' };

test('a question opens a conversation named by it, is saved before its answer and queues one job; a retried request stays in its thread', async () => {
  const { askOpportunityAssistant } = await load();
  const { tables, client } = memory();
  const first = await askOpportunityAssistant(client, member, { question: '¿Qué cierra esta semana?', requestId: 'r1' });
  assert.equal(tables.opportunity_assistant_threads.length, 1);
  assert.equal(tables.opportunity_assistant_threads[0].title, '¿Qué cierra esta semana?');
  assert.equal(first.key, 'assistant:u1:r1');
  assert.deepEqual(tables.opportunity_assistant_messages.map(row => [row.thread_id, row.question, row.answer]), [[first.threadId, '¿Qué cierra esta semana?', null]]);
  assert.deepEqual(tables.opportunity_jobs.map(row => [row.kind, row.dedupe_key, row.payload, row.opportunity_id]), [['assistant', 'assistant:u1:r1', { requestId: 'r1', threadId: first.threadId }, undefined]]);
  const next = await askOpportunityAssistant(client, member, { question: '¿Y la siguiente?', requestId: 'r2', threadId: first.threadId });
  assert.equal(next.threadId, first.threadId);
  await askOpportunityAssistant(client, member, { question: '¿Y la siguiente?', requestId: 'r2', threadId: first.threadId });
  assert.equal(tables.opportunity_assistant_messages.length, 2, 'the same request saves once');
  assert.equal(tables.opportunity_jobs.length, 2);
  assert.equal((await askOpportunityAssistant(client, member, { question: '¿Qué cierra esta semana?', requestId: 'r1' })).threadId, first.threadId);
  assert.equal(tables.opportunity_assistant_threads.length, 1, 'a retried first question opens no second conversation');
  await assert.rejects(askOpportunityAssistant(client, { ...member, userId: 'u2' }, { question: 'Hola', requestId: 'r3', threadId: first.threadId }),
    (error: any) => error.status === 404, 'another person\'s conversation is not found');
  await assert.rejects(askOpportunityAssistant(client, member, { question: 'Hola', requestId: 'r1', threadId: (await askOpportunityAssistant(client, member, { question: 'Otra', requestId: 'r4' })).threadId }),
    (error: any) => error.status === 409, 'a request belongs to its first conversation');
});

test('the answer reads what the person can see, the conversation so far and no future demand for a member; it keeps only real opportunities', async () => {
  const { askOpportunityAssistant, runOpportunityAssistant } = await load();
  // The order reads the real clock: the open ones close one and two days from now, whenever the test runs.
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const list = (args: any) => {
    if (args.p_query === 'camaras') return [opportunity('o2', 'Cámaras de seguridad Castro', { deadline_at: inDays(2) })];
    if (args.p_view === 'recommended') return [opportunity('o1', 'Aseo Hospital de Castro', { deadline_at: inDays(1) }), opportunity('o2', 'Cámaras de seguridad Castro')];
    return [opportunity('o3', 'Guardias Puerto Montt', { deadline_at: '2026-09-01T18:00:00Z' })];
  };
  const { tables, rpcs, client } = memory({
    organization_members: [{ organization_id: 'org', user_id: 'u1', role: 'member' }],
    opportunity_company_context: [{ organization_id: 'org', offer: 'Seguridad y aseo', services: ['Monitoreo de cámaras'] }],
    opportunity_work: [{ organization_id: 'org', opportunity_id: 'o1', state: 'working' }],
    opportunity_purchase_plan: [{ organization_id: 'org', year: 2026, institution: 'Municipalidad', description: 'Cámaras', amount: 1, month: 12 }],
  }, { list });
  const { threadId } = await askOpportunityAssistant(client, member, { question: 'Hola', requestId: 'r0' });
  tables.opportunity_assistant_messages[0].answer = { answer: 'Hola, ¿en qué te ayudo?', cards: [], handoff: null, followups: [] };
  await askOpportunityAssistant(client, member, { question: '¿Hay algo de cámaras que cierre pronto?', requestId: 'r1', threadId });
  (globalThis as any).__reply = () => ({ answer: 'La de **cámaras** cierra el martes.', opportunities: [{ id: 'o2', note: 'Cierra el martes' }, { id: 'zz', note: 'Inventada' }],
    handoff: { id: 'o2', question: '¿Qué garantía piden?' }, followups: ['¿Qué piden?'] });
  const job = { id: 'job-1', organization_id: 'org', requested_by: 'u1', opportunity_id: null, kind: 'assistant', payload: { requestId: 'r1', threadId }, lease_token: 'l', state: 'running' };
  const saved = await runOpportunityAssistant(client, job);
  const call = (globalThis as any).__call;
  assert.deepEqual([call.role, call.category, call.step], ['chat', 'chat', 'answer']);
  assert.ok(rpcs.filter(([name]) => name === 'opportunity_workspace_list').every(([, args]) => args.p_user === 'u1' && args.p_org === 'org'), 'the list of that person, with its permissions');
  assert.ok(rpcs.some(([, args]) => args?.p_query === 'camaras'), 'the words of the question are looked up');
  assert.ok(!rpcs.some(([, args]) => args?.p_view === 'assigned'), 'a member has no «assigned» view');
  const listed = JSON.parse(call.prompt.match(/la IA: recommended = calza, excluded = descartada, pending = sin evaluar\): (\[.*\])\n/)[1]);
  assert.deepEqual(listed.map((item: any) => item.id), ['o1', 'o2', 'o3'], 'open and closing soonest first, the closed one last');
  assert.equal(listed[0].estado, 'en curso');
  assert.match(call.prompt, /Conversación previa: \[\{"pregunta":"Hola","respuesta":"Hola, ¿en qué te ayudo\?"\}\]/);
  assert.doesNotMatch(call.prompt, /Demanda futura \(/, 'the plan is for admins');
  assert.deepEqual(saved.cards.map((card: any) => card.id), ['o2']);
  assert.equal(saved.handoff.title, 'Cámaras de seguridad Castro');
  assert.deepEqual(tables.opportunity_assistant_messages.find(row => row.request_id === 'r1').answer, saved, 'the answer is saved with its message');
});

test('an admin\'s answer also reads the future demand, the coming months first', async () => {
  const { askOpportunityAssistant, runOpportunityAssistant } = await load();
  const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(new Date()));
  const { client } = memory({
    organization_members: [{ organization_id: 'org', user_id: 'a1', role: 'admin' }],
    opportunity_purchase_plan: [
      { organization_id: 'org', year: 2026, institution: 'Hospital Grande', description: 'Aseo ya pasado', amount: 900, month: Math.max(1, month - 1) },
      { organization_id: 'org', year: 2026, institution: 'Municipalidad de Castro', description: 'Cámaras de televigilancia', amount: 100, month },
      { organization_id: 'org', year: 2025, institution: 'Año anterior', description: 'No va', amount: 5000, month: 12 },
    ],
  });
  const admin = { organizationId: 'org', userId: 'a1', role: 'admin' };
  const { threadId } = await askOpportunityAssistant(client, admin, { question: '¿Qué planean comprar?', requestId: 'r1' });
  (globalThis as any).__reply = () => ({ answer: 'Castro planea cámaras.', opportunities: [], handoff: null, followups: [] });
  await runOpportunityAssistant(client, { id: 'j', organization_id: 'org', requested_by: 'a1', opportunity_id: null, kind: 'assistant', payload: { requestId: 'r1', threadId }, lease_token: 'l', state: 'running' });
  const demand = JSON.parse((globalThis as any).__call.prompt.match(/Demanda futura \(Plan Anual de Compras de los organismos, referencial\): (\[.*\])\n/)[1]);
  assert.equal(demand[0].organismo, 'Municipalidad de Castro', 'what comes next before what is larger');
  assert.ok(!demand.some((line: any) => line.organismo === 'Año anterior'), 'only the latest year read');
});

test('the side list holds the person\'s conversations and the opportunities where they talked with its chat, if they can still open them', async () => {
  const { readOpportunityAssistant } = await load();
  assert.deepEqual(await readOpportunityAssistant(memory({}, { missing: ['opportunity_assistant_threads'] }).client, member), { available: false, threads: [], opportunities: [] });
  const { client } = memory({
    opportunity_assistant_threads: [{ id: 't1', organization_id: 'org', user_id: 'u1', title: 'Cierres', updated_at: '2026-10-18T10:00:00Z' },
      { id: 't2', organization_id: 'org', user_id: 'u2', title: 'De otra persona', updated_at: '2026-10-18T11:00:00Z' }],
    opportunity_chat_messages: [
      { organization_id: 'org', user_id: 'u1', opportunity_id: 'o1', created_at: '2026-10-18T09:00:00Z' },
      { organization_id: 'org', user_id: 'u1', opportunity_id: 'o1', created_at: '2026-10-17T09:00:00Z' },
      { organization_id: 'org', user_id: 'u1', opportunity_id: 'o9', created_at: '2026-10-16T09:00:00Z' },
    ],
    commercial_opportunities: [{ id: 'o1', organization_id: 'org', title: 'Aseo Hospital' }, { id: 'o9', organization_id: 'org', title: 'Reasignada' }],
  });
  (globalThis as any).__readable = ['o1'];
  const view = await readOpportunityAssistant(client, member);
  (globalThis as any).__readable = null;
  assert.deepEqual(view.threads.map((thread: any) => thread.id), ['t1']);
  assert.deepEqual(view.opportunities, [{ id: 'o1', title: 'Aseo Hospital', updated_at: '2026-10-18T09:00:00Z' }]);
});

test('a conversation shows why a question has no answer yet, and deleting it removes it', async () => {
  const { askOpportunityAssistant, readAssistantThread, deleteAssistantThread } = await load();
  const { tables, client } = memory();
  const { threadId } = await askOpportunityAssistant(client, member, { question: '¿Qué cierra?', requestId: 'r1' });
  tables.opportunity_jobs[0] = { ...tables.opportunity_jobs[0], state: 'blocked', error: 'Se alcanzó el presupuesto disponible para este trabajo.' };
  const { thread, messages } = await readAssistantThread(client, member, threadId);
  assert.equal(thread.title, '¿Qué cierra?');
  assert.deepEqual(messages.map((message: any) => [message.requestId, message.job]), [['r1', { state: 'blocked', error: 'Se alcanzó el presupuesto disponible para este trabajo.' }]]);
  await assert.rejects(readAssistantThread(client, { ...member, userId: 'u2' }, threadId), (error: any) => error.status === 404);
  await assert.rejects(deleteAssistantThread(client, { ...member, userId: 'u2' }, threadId), (error: any) => error.status === 404);
  await deleteAssistantThread(client, member, threadId);
  assert.equal(tables.opportunity_assistant_threads.length, 0);
});
