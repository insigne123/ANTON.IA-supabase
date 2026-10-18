import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

// «Demanda futura» with ChileCompra's file, the database and the model in memory.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
    './workspace-access': 'export function assertOpportunityAdmin(scope){ if (scope.role !== "admin" && scope.role !== "owner") { const e = new Error("Esta acción corresponde a un administrador."); e.status = 403; throw e } }',
    './workspace-store': 'export function opportunityDb(result){ if (result.error) throw result.error; return result.data } export async function createPrivateOpportunity(client, scope, input, options){ globalThis.__created = { input, options }; return "op-1" }',
    './workspace-ai': 'export async function opportunityGenerate(client, job, input){ return globalThis.__screen(input) }',
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/purchase-plan';`, loader: 'ts', resolveDir: process.cwd() },
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

const HEADER = 'institucion_nombre;rut_institucion;codigo_producto;descripcion_producto;cantidad_estimada;monto_unitario_clp;monto_estimado_clp;mes_estimado;trimestre_estimado;estado_planificacion';
// As ChileCompra ships it: UTF-8 with a BOM, unquoted, runs of spaces; a quote inside a text, a «;» inside a description, a
// description cut short with its quote open, one that breaks over two lines, and a loose piece of text.
const CSV = `﻿${HEADER}
I  MUNICIPALIDAD  DE  AYSEN;100049;5296834;Servicios  de  Aseo  Gestión  Interna;1;70600000;70600000;11;4;Publicado
INSTITUTO NACIONAL DE PROPIEDAD INDUSTRIAL;7044;8803;EXTERNALIZACIÓN CALL CENTER;1;120000000.0;120000000.0;3;1;Publicado
I MUNICIPALIDAD LO BARNECHEA;2210;991;CINTILLOS TIPO "CALL CENTER" (AUDÍFONOS);40;15000;600000;6;2;Publicado
HOSPITAL X;55;77;Aseo; limpieza y sanitización;1;1000;1000;2;1;Publicado
SERVICIO DE SALUD Y;56;78;"Servicio de aseo hospitalario cortado en el lími;1;5000;5000;12;4;Publicado
MUNICIPALIDAD DE BUIN;66;88;Servicio de aseo
de plazas y parques;12;300000;3600000;8;3;Publicado
MUNICIPALIDAD DE BUIN;66;89;Calzado de seguridad;10;20000;200000;5;2;Publicado
texto suelto sin su línea
`;
const zipped = async (text: string) => { const zip = new JSZip(); zip.file('pacorganismos_2026.csv', text); return zip.generateAsync({ type: 'uint8array' }); };
const fetchOf = (status: number, body?: Uint8Array) => (async () => new Response(body ? new Uint8Array(body).buffer : null, { status })) as unknown as typeof fetch;

test('the plan is read as a stream: the lines that say a word, repaired when they break, and a loose piece skipped', async () => {
  const { readPurchasePlanCandidates } = await load();
  const result = await readPurchasePlanCandidates(2026, ['aseo', 'call center'], { fetch: fetchOf(200, await zipped(CSV)) });
  assert.equal(result.year, 2026);
  assert.equal(result.read, 7);
  assert.equal(result.skipped, 1, 'the loose text is left out');
  assert.deepEqual(result.candidates.map((line: any) => line.description).sort(), [
    'Aseo; limpieza y sanitización', 'CINTILLOS TIPO "CALL CENTER" (AUDÍFONOS)', 'EXTERNALIZACIÓN CALL CENTER',
    'Servicio de aseo de plazas y parques', 'Servicio de aseo hospitalario cortado en el lími', 'Servicios de Aseo Gestión Interna',
  ].sort());
  const buin = result.candidates.find((line: any) => line.productCode === '88');
  assert.deepEqual([buin.quantity, buin.amount, buin.month], [12, 3600000, 8], 'the broken line keeps its numbers in their columns');
  const aysen = result.candidates.find((line: any) => line.institutionCode === '100049');
  assert.deepEqual([aysen.institution, aysen.amount, aysen.month], ['I. Municipalidad de Aysen', 70600000, 11]);
});

test('a year not published yet reads as null, another failure says so, and a file in another format is not read as empty', async () => {
  const { readPurchasePlanCandidates } = await load();
  assert.equal(await readPurchasePlanCandidates(2027, ['aseo'], { fetch: fetchOf(404) }), null);
  await assert.rejects(readPurchasePlanCandidates(2026, ['aseo'], { fetch: fetchOf(500) }), /No pudimos descargar/);
  await assert.rejects(readPurchasePlanCandidates(2026, ['aseo'], { fetch: fetchOf(200, await zipped('a;b\n1;2\n')) }), /cambió de formato/);
  await assert.rejects(readPurchasePlanCandidates(2026, ['aseo'], { fetch: fetchOf(200, await zipped(`${HEADER}\n`)) }), /cambió de formato/);
});

/** The tables the reading touches, in memory, with the few query methods it uses. */
function memory(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { opportunity_source_snapshots: [], opportunity_purchase_plan: [], opportunity_jobs: [], opportunity_company_context: [], ...seed };
  const query = (name: string) => {
    let rows = () => tables[name];
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: 'select' | 'insert' | 'upsert' | 'delete'; values?: any; conflict?: string[] } = { kind: 'select' };
    const run = () => {
      const match = (row: any) => filters.every(filter => filter(row));
      if (action.kind === 'insert') { tables[name].push(...[].concat(action.values)); return { data: action.values, error: null }; }
      if (action.kind === 'upsert') {
        for (const value of [].concat(action.values) as any[]) {
          const index = tables[name].findIndex(row => action.conflict!.every(key => row[key] === value[key]));
          if (index >= 0) tables[name][index] = { ...tables[name][index], ...value }; else tables[name].push({ id: `job-${tables[name].length + 1}`, ...value });
        }
        return { data: { id: `job-${tables[name].length}` }, error: null };
      }
      if (action.kind === 'delete') { tables[name] = tables[name].filter(row => !match(row)); return { data: null, error: null }; }
      return { data: rows().filter(match), error: null };
    };
    const builder: any = {
      select: () => builder, insert: (values: any) => { action = { kind: 'insert', values }; return builder; },
      upsert: (values: any, options: any) => { action = { kind: 'upsert', values, conflict: String(options.onConflict).split(',') }; return builder; },
      delete: () => { action = { kind: 'delete' }; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return builder; },
      order: () => builder, limit: () => builder,
      maybeSingle: async () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null }; },
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  return { tables, client: { from: query } as any };
}

test('a reading keeps what the model kept, replaces the previous reading and leaves the made-up ids out', async () => {
  const { runOpportunityDemand, planYear } = await load();
  const { tables, client } = memory({ opportunity_purchase_plan: [{ organization_id: 'org', year: planYear(), line_id: 'old0000000000000', run_id: 'previous' }] });
  (globalThis as any).__screen = (input: any) => {
    const ids = [...input.prompt.matchAll(/^([a-f0-9]{16}) \| (.+?) \|/gm)].map((m: RegExpMatchArray) => ({ id: m[1], name: m[2] }));
    const keep = ids.filter((line: any) => !/Barnechea/.test(line.name)).map((line: any) => ({ id: line.id, fit: 'alta', reason: '  Piden   lo que vendes ' }));
    return { matches: [...keep, { id: 'ffffffffffffffff', fit: 'alta', reason: 'inventada' }] };
  };
  const job = { id: 'run-1', organization_id: 'org', requested_by: 'u1', payload: {}, kind: 'demand' };
  const context = { offer: 'Servicios de aseo y contact center', services: ['Aseo'], exclusions: [], criteria: { keywords: ['call center'] } };
  const result = await runOpportunityDemand(client, job, context, Date.now(), { fetch: fetchOf(200, await zipped(CSV)) });
  assert.equal(result.waiting, false);
  assert.deepEqual([result.candidates, result.kept], [6, 5]);
  assert.ok(tables.opportunity_purchase_plan.some(row => row.description === 'EXTERNALIZACIÓN CALL CENTER'));
  assert.ok(!tables.opportunity_purchase_plan.some(row => /CINTILLOS/.test(row.description)), 'what the model left out stays out');
  assert.ok(tables.opportunity_purchase_plan.every(row => row.run_id === 'run-1' && row.reason === 'Piden lo que vendes'));
  assert.equal(tables.opportunity_source_snapshots.length, 1, 'the candidates are kept for a job that resumes');
});

test('reading the demand and following a line are for admins, and a line becomes an opportunity with its origin', async () => {
  const { readOpportunityDemand, followPlanLine } = await load();
  const member = { organizationId: 'org', userId: 'u2', role: 'member' };
  const { client } = memory({ opportunity_purchase_plan: [{ organization_id: 'org', year: 2026, line_id: 'abcdefabcdefabcd', run_id: 'r', institution: 'I. Municipalidad de Aysen',
    institution_code: '100049', product_code: '1', description: 'Servicios de Aseo Gestión Interna', quantity: 1, unit_amount: 70600000, amount: 70600000, month: 11, quarter: 4,
    fit: 'alta', reason: 'Piden aseo', created_at: '2026-10-17T12:00:00Z' }] });
  await assert.rejects(readOpportunityDemand(client, member), /administrador/);
  await assert.rejects(followPlanLine(client, member, { year: 2026, lineId: 'abcdefabcdefabcd' }), /administrador/);
  const admin = { organizationId: 'org', userId: 'u1', role: 'admin' };
  const view = await readOpportunityDemand(client, admin);
  assert.equal(view.available, true); assert.equal(view.year, 2026); assert.equal(view.matches[0].lineId, 'abcdefabcdefabcd');
  assert.equal(await followPlanLine(client, admin, { year: 2026, lineId: 'abcdefabcdefabcd' }), 'op-1');
  const created = (globalThis as any).__created;
  assert.equal(created.input.kind, 'commercial');
  assert.match(created.input.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(created.options, { reason: 'En el Plan Anual de Compras 2026 de I. Municipalidad de Aysen', origin: 'purchase_plan', documentName: 'Plan Anual de Compras.txt',
    dedupeKey: 'plan:2026:abcdefabcdefabcd', activity: 'Oportunidad agregada desde el Plan Anual de Compras' });
  await assert.rejects(followPlanLine(client, admin, { year: 2026, lineId: '0000000000000000' }), /ya no está/);
});

// What ChileCompra's CloudFront answers a Google Cloud network, and what S3 answers for a year not published.
const blockedFetch = (async () => new Response('<HTML><H1>403 ERROR</H1><H2>The request could not be satisfied.</H2>Request blocked.</HTML>',
  { status: 403, headers: { server: 'CloudFront', 'content-type': 'text/html' } })) as unknown as typeof fetch;
const missingFetch = (async () => new Response('<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
  { status: 403, headers: { server: 'AmazonS3', 'content-type': 'application/xml' } })) as unknown as typeof fetch;
/** A copy in parts, cut anywhere (even inside a line): the reader takes them as one stream. */
const copyOf = (parts: Record<number, string[]>) => async (year: number) => parts[year] ? (async function* () { yield* parts[year]; })() : null;

test('when ChileCompra blocks the server, the plan is read from the copy, cut in parts anywhere, with the same lines', async () => {
  const { readPurchasePlanCandidates } = await load();
  const direct = await readPurchasePlanCandidates(2026, ['aseo', 'call center'], { fetch: fetchOf(200, await zipped(CSV)) });
  const cut = CSV.indexOf('PROPIEDAD') + 4;
  const copied = await readPurchasePlanCandidates(2026, ['aseo', 'call center'], { fetch: blockedFetch, mirror: copyOf({ 2026: [CSV.slice(0, cut), CSV.slice(cut)] }) });
  assert.equal(copied.source, 'copia'); assert.equal(direct.source, 'chilecompra');
  assert.deepEqual([copied.read, copied.skipped], [direct.read, direct.skipped]);
  assert.deepEqual(copied.candidates.map((line: any) => line.lineId), direct.candidates.map((line: any) => line.lineId), 'the same ids, so a followed line stays the same');
});

test('a year not published reads as null, but a blocked year with no copy says what happens', async () => {
  const { readPurchasePlanCandidates } = await load();
  assert.equal(await readPurchasePlanCandidates(2027, ['aseo'], { fetch: missingFetch, mirror: copyOf({}) }), null);
  await assert.rejects(readPurchasePlanCandidates(2026, ['aseo'], { fetch: blockedFetch, mirror: copyOf({}) }), /no deja descargar el Plan Anual de Compras 2026 desde nuestro servidor/);
  // Another failure of ChileCompra also falls back to the copy.
  const failing = fetchOf(500);
  assert.equal((await readPurchasePlanCandidates(2026, ['aseo'], { fetch: failing, mirror: copyOf({ 2026: [CSV] }) })).source, 'copia');
});

test('a reading blocked this year takes last year\'s copy, and with no copy at all says it is blocked, not unpublished', async () => {
  const { runOpportunityDemand, planYear } = await load();
  (globalThis as any).__screen = () => ({ matches: [] });
  const context = { offer: 'Aseo', services: ['Aseo'], exclusions: [], criteria: { keywords: ['call center'] } };
  const year = planYear();
  const lastYear = memory();
  const result = await runOpportunityDemand(lastYear.client, { id: 'run-2', organization_id: 'org', requested_by: 'u1', payload: {}, kind: 'demand' }, context, Date.now(),
    { fetch: blockedFetch, mirror: copyOf({ [year - 1]: [CSV] }) });
  assert.deepEqual([result.year, result.source, result.candidates], [year - 1, 'copia', 6]);
  const none = memory();
  await assert.rejects(runOpportunityDemand(none.client, { id: 'run-3', organization_id: 'org', requested_by: 'u1', payload: {}, kind: 'demand' }, context, Date.now(),
    { fetch: blockedFetch, mirror: copyOf({}) }), /no deja descargar/);
});
