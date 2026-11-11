import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The jobs, the opportunities, the alerts and Resend in memory: nothing leaves the test.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/mail-sender-preference': 'export async function readMailSenderPreference(){ return { resolved: null } }',
    '@/lib/services/token-service': 'export const tokenService = { async getToken(){ return null } }',
    '@/lib/server-auth-helpers': 'export async function refreshGoogleToken(){ return null } export async function refreshMicrosoftToken(){ return null }',
  };
  const bundle = await build({
    stdin: { contents: "export * from './src/lib/server/commercial-opportunities/source-health';", loader: 'ts', resolveDir: process.cwd() },
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

type Row = Record<string, any>;
const like = (value: unknown, pattern: string) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`).test(String(value));
/** Tables in memory with the filters these reads use; `updates` keeps what each update asked for. */
function database(tables: Record<string, Row[]>) {
  const updates: Row[] = [];
  const client = {
    from(table: string) {
      const rows = tables[table] ||= [];
      const tests: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null; let head = false; let order: string | null = null;
      const matching = () => rows.filter(row => tests.every(check => check(row)));
      const run = () => {
        const found = matching();
        if (patch) { for (const row of found) Object.assign(row, patch); updates.push(...found.map(row => ({ id: row.id, ...patch }))); }
        if (order) found.sort((a, b) => Date.parse(b[order!]) - Date.parse(a[order!]));
        return found;
      };
      const query: any = {
        select: (_columns: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return query; },
        update: (values: Row) => { patch = values; return query; },
        insert: async (row: Row) => { rows.push(row); return { error: null }; },
        eq: (column: string, value: unknown) => { tests.push(row => row[column] === value); return query; },
        gte: (column: string, value: string) => { tests.push(row => row[column] >= value); return query; },
        lt: (column: string, value: string) => { tests.push(row => row[column] < value); return query; },
        like: (column: string, pattern: string) => { tests.push(row => like(row[column], pattern)); return query; },
        not: (column: string, operator: string, pattern: string) => { assert.equal(operator, 'like'); tests.push(row => !like(row[column], pattern)); return query; },
        order: (column: string) => { order = column; return query; },
        limit: () => query,
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => { const found = run(); return Promise.resolve(head ? { count: found.length, data: null, error: null } : { data: found, error: null }).then(resolve); },
      };
      return query;
    },
  };
  return { client: client as any, tables, updates };
}

const ORG = 'org-1';
const job = (id: string, dedupe: string, state: string, error: string | null = null, payload: Row = {}) => ({ id, organization_id: ORG, kind: 'tenders', dedupe_key: dedupe, state, error, payload: { keyword: id, ...payload }, attempts: 7, result: { retry: { tries: 6 } } });

test('in the afternoon, the Compra Ágil searches Mercado Público failed are queued once more, a timeout with pages of 10', async () => {
  const { requeueFailedCompraAgil } = await load();
  const prefix = 'daily:2026-11-08:3';
  const db = database({ opportunity_jobs: [
    job('timeout', `${prefix}:tenders:agil:a`, 'failed', 'Compra Ágil respondió 504 (falla de Mercado Público).'),
    job('busy', `${prefix}:tenders:agil:b`, 'failed', 'Compra Ágil no aceptó más consultas del ticket por ahora (429).'),
    job('ticket', `${prefix}:tenders:agil:c`, 'failed', 'Compra Ágil rechazó el ticket.'),
    job('done', `${prefix}:tenders:agil:d`, 'ready'),
    job('again', `${prefix}:tenders:agil:e`, 'failed', 'Compra Ágil respondió 504 (falla de Mercado Público).', { afternoon: true }),
    job('listing', `${prefix}:tenders`, 'failed', 'Compra Ágil respondió 504 (falla de Mercado Público).'),
    job('yesterday', 'daily:2026-11-07:3:tenders:agil:a', 'failed', 'Compra Ágil respondió 504 (falla de Mercado Público).'),
    { ...job('other-org', `${prefix}:tenders:agil:a`, 'failed', 'Compra Ágil respondió 504 (falla de Mercado Público).'), organization_id: 'org-2' },
  ] });
  assert.equal(await requeueFailedCompraAgil(db.client, ORG, prefix), 2);
  const state = Object.fromEntries(db.tables.opportunity_jobs.map(row => [`${row.organization_id}:${row.id}`, row]));
  // A timeout comes back asking pages of 10; a busy ticket comes back as it was.
  assert.deepEqual([state['org-1:timeout'].state, state['org-1:timeout'].attempts, state['org-1:timeout'].error, state['org-1:timeout'].result], ['queued', 0, null, null]);
  assert.deepEqual(state['org-1:timeout'].payload, { keyword: 'timeout', afternoon: true, small: true });
  assert.deepEqual(state['org-1:busy'].payload, { keyword: 'busy', afternoon: true });
  assert.equal(state['org-1:busy'].state, 'queued');
  // A rejected ticket, a search that worked, one already given its round, the listing, another day and another organization stay.
  for (const key of ['org-1:ticket', 'org-1:again', 'org-1:listing', 'org-1:yesterday', 'org-2:other-org']) assert.equal(state[key].state, 'failed', key);
  assert.equal(state['org-1:done'].state, 'ready');
  // A second pass the same afternoon finds nothing to queue.
  assert.equal(await requeueFailedCompraAgil(db.client, ORG, prefix), 0);
});

const env = { RESEND_API_KEY: 're_1', PROVIDER_ALERT_EMAILS: 'ops@yago.cl', NEXT_PUBLIC_APP_URL: 'https://app.example.test/' };
function resend() {
  const sent: any[] = [];
  const fetch = async (input: string | URL, init: RequestInit = {}) => {
    if (String(input) === 'https://api.resend.com/emails') { sent.push(JSON.parse(String(init.body))); return new Response('{}'); }
    return new Response('', { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}
/** A day of the three sources: four organizations, six Compra Ágil words each, and what arrived. */
function day(date: string, options: { agilFailed?: number; agil?: number; tender?: number; hiring?: number; hiringRan?: boolean } = {}) {
  const jobs: Row[] = []; const found: Row[] = [];
  const at = `${date}T15:00:00.000Z`;
  for (let org = 0; org < 4; org++) {
    jobs.push({ kind: 'tenders', dedupe_key: `daily:${date}:1:tenders`, state: 'ready' });
    if (options.hiringRan !== false) jobs.push({ kind: 'hiring', dedupe_key: `daily:${date}:1:hiring`, state: 'ready' });
    for (let word = 0; word < 6; word++) jobs.push({ kind: 'tenders', dedupe_key: `daily:${date}:1:tenders:agil:${org}${word}`, state: org * 6 + word < (options.agilFailed ?? 0) ? 'failed' : 'ready' });
  }
  for (const [kind, count] of [['compra_agil', options.agil ?? 0], ['tender', options.tender ?? 0], ['hiring', options.hiring ?? 0]] as const)
    for (let index = 0; index < count; index++) found.push({ kind, created_at: at });
  return { jobs, found };
}
const world = (...days: Array<ReturnType<typeof day>>) => database({
  opportunity_jobs: days.flatMap(item => item.jobs), commercial_opportunities: days.flatMap(item => item.found), antonia_provider_usage_snapshots: [], profiles: [] });

test('a source that ran two days in a row and brought nothing is told once, and again only after it came back', async () => {
  const { checkOpportunitySources } = await load();
  // 7 and 8 Nov 2026: every Compra Ágil search failed; tenders and «Empresas contratando» kept arriving.
  const db = world(day('2026-11-07', { agilFailed: 24, tender: 2012, hiring: 51 }), day('2026-11-08', { agilFailed: 24, tender: 44, hiring: 34 }));
  const mail = resend();
  // Before five in the afternoon in Chile the day is not judged, and after seven it is not read again.
  for (const hour of ['18:00', '23:00']) assert.deepEqual(
    await checkOpportunitySources(db.client, { fetch: mail.fetch, env, now: new Date(`2026-11-08T${hour}:00.000Z`) }), { checked: false, sources: [] });
  const evening = new Date('2026-11-08T21:00:00.000Z');
  const told = await checkOpportunitySources(db.client, { fetch: mail.fetch, env, now: evening });
  assert.deepEqual(told.sources.map((source: any) => [source.source, source.silent, source.alert?.sentTo ?? null]), [['tender', false, null], ['compra_agil', true, 1], ['hiring', false, null]]);
  assert.equal(mail.sent.length, 1);
  assert.deepEqual(mail.sent[0].to, ['ops@yago.cl']);
  assert.equal(mail.sent[0].subject, 'Compra Ágil lleva 2 días sin traer oportunidades');
  assert.match(mail.sent[0].text, /7 de noviembre: fallaron las 24 búsquedas, 0 oportunidades nuevas\.\n8 de noviembre: fallaron las 24 búsquedas, 0 oportunidades nuevas\./);
  assert.match(mail.sent[0].text, /Todas las búsquedas fallaron/);
  assert.match(mail.sent[0].text, /Abrir Administración: https:\/\/app\.example\.test\/dashboard\/admin/);
  assert.equal(db.tables.antonia_provider_usage_snapshots.at(-1)!.provider, 'opportunities:compra_agil');
  assert.equal(db.tables.antonia_provider_usage_snapshots.at(-1)!.usage.level, 'empty');
  // The next hour, and the third silent day, say nothing more.
  await checkOpportunitySources(db.client, { fetch: mail.fetch, env, now: new Date('2026-11-08T21:40:00.000Z') });
  const third = day('2026-11-09', { agilFailed: 24, tender: 4, hiring: 4 });
  db.tables.opportunity_jobs.push(...third.jobs); db.tables.commercial_opportunities.push(...third.found);
  await checkOpportunitySources(db.client, { fetch: mail.fetch, env, now: new Date('2026-11-09T21:00:00.000Z') });
  assert.equal(mail.sent.length, 1);
  // It comes back on the 10th: noted, without an email. A later silence is told again.
  const back = day('2026-11-10', { agil: 417, tender: 1808, hiring: 42 });
  db.tables.opportunity_jobs.push(...back.jobs); db.tables.commercial_opportunities.push(...back.found);
  await checkOpportunitySources(db.client, { fetch: mail.fetch, env, now: new Date('2026-11-10T21:00:00.000Z') });
  assert.equal(mail.sent.length, 1);
  assert.equal(db.tables.antonia_provider_usage_snapshots.at(-1)!.usage.level, 'ok');
  for (const date of ['2026-11-11', '2026-11-12']) { const quiet = day(date, { tender: 900, hiring: 30 }); db.tables.opportunity_jobs.push(...quiet.jobs); db.tables.commercial_opportunities.push(...quiet.found); }
  await checkOpportunitySources(db.client, { fetch: mail.fetch, env, now: new Date('2026-11-12T21:00:00.000Z') });
  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].text, /las 24 búsquedas terminaron, 0 oportunidades nuevas/);
  assert.match(mail.sent[1].text, /puede ser normal en días de poca publicación/);
});

test('one quiet day, a source that did not run, or no recipients: no alert is recorded as told', async () => {
  const { checkOpportunitySources } = await load();
  const evening = new Date('2026-11-08T21:00:00.000Z');
  // Yesterday brought results: one silent day is not news.
  const one = world(day('2026-11-07', { agil: 300, tender: 10, hiring: 5 }), day('2026-11-08', { agilFailed: 24, tender: 10, hiring: 5 }));
  const mail = resend();
  assert.ok((await checkOpportunitySources(one.client, { fetch: mail.fetch, env, now: evening })).sources.every((source: any) => !source.silent));
  // «Empresas contratando» did not run yesterday (nobody has it on): skipped, whatever it found.
  const off = world(day('2026-11-07', { agil: 1, tender: 1, hiringRan: false }), day('2026-11-08', { agil: 1, tender: 1 }));
  const skipped = await checkOpportunitySources(off.client, { fetch: mail.fetch, env, now: evening });
  assert.equal(skipped.sources.find((source: any) => source.source === 'hiring').skipped, true);
  assert.equal(mail.sent.length, 0);
  // Without recipients the silence is seen but not kept as told, so it is told once they are set.
  const silent = world(day('2026-11-07', { tender: 1, hiring: 1 }), day('2026-11-08', { tender: 1, hiring: 1 }));
  const nobody = await checkOpportunitySources(silent.client, { fetch: mail.fetch, env: { RESEND_API_KEY: 're_1' }, now: evening });
  assert.deepEqual(nobody.sources.find((source: any) => source.source === 'compra_agil').alert, { sentTo: 0, error: 'Falta PROVIDER_ALERT_EMAILS.' });
  assert.equal(silent.tables.antonia_provider_usage_snapshots.length, 0);
});
