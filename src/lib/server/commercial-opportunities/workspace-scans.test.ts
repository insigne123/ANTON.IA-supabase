import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The reading of images and scanned pages, with the model, the database and the stored file in memory.
const bundle = await build({
  stdin: { contents: `export { runDocumentScan, activeDocumentScans } from './src/lib/server/commercial-opportunities/workspace-scans';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /auth-utils$|\/workspace-store$|\/workspace-ai$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents:
      args.path.endsWith('auth-utils') ? 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}'
        : args.path.endsWith('workspace-store') ? 'export function opportunityDb(result){ if (result.error) throw Error(result.error.message); return result.data }'
          : `import { AuthError } from '@/lib/server/auth-utils';
             export async function opportunityGenerate(client, job, input){ globalThis.__calls.push(input); const answer = globalThis.__answer(input);
               if (answer === 'unfinished') throw new AuthError('La evaluación no terminó. Conservamos los datos y el consumo observado.', 503);
               if (answer === 'budget') throw new AuthError('Se alcanzó el presupuesto disponible para este trabajo.', 402);
               return answer }` }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { runDocumentScan, activeDocumentScans } = compiled.exports;

type Call = { table: string; op: string; values?: any; filters: Array<[string, unknown]> };
function fixture(doc: Record<string, unknown> | null, lastOrdinal: number | null = 4) {
  const calls: Call[] = [];
  const client = {
    storage: { from: () => ({ download: async () => ({ data: new Blob([Uint8Array.from([37, 80, 68, 70])]), error: null }) }) },
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }; calls.push(call);
      const chain: any = {
        select: () => chain, order: () => chain, limit: () => chain, like: (column: string, value: unknown) => { call.filters.push([column, value]); return chain; },
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return chain; },
        in: (column: string, value: unknown) => { call.filters.push([column, value]); return chain; },
        update: (values: unknown) => { call.op = 'update'; call.values = values; return chain; },
        delete: () => { call.op = 'delete'; return chain; },
        insert: (values: unknown) => { call.op = 'insert'; call.values = values; return chain; },
        maybeSingle: async () => ({ error: null, data: table === 'opportunity_documents' ? doc : table === 'opportunity_jobs' ? { id: 'job' }
          : lastOrdinal === null ? null : { ordinal: lastOrdinal } }),
        then: (resolve: (value: unknown) => void) => resolve({ data: table === 'opportunity_jobs' ? (globalThis as any).__active || [] : null, error: null }),
      };
      return chain;
    },
  };
  return { client, calls };
}
const job = (payload: Record<string, unknown>) => ({ id: 'job', organization_id: 'org', opportunity_id: 'op', requested_by: 'u1', lease_token: 'lease', kind: 'evaluate',
  dedupe_key: 'scan:doc', state: 'running', attempts: 1, payload: { scan: true, documentId: 'doc', ...payload } });
const scanned = { id: 'doc', name: 'Resolución firmada.pdf', mime: 'application/pdf', storage_path: 'org/op/doc/x.pdf', extraction_status: 'scan', pages_total: 10 };

test('a scanned PDF is read in groups of pages, saved after its own fragments, and a page without answer leaves it partial', async () => {
  (globalThis as any).__calls = [];
  (globalThis as any).__answer = (input: any) => ({ pages: input.prompt.includes('páginas 9 y 10') ? [{ page: 10, text: 'Firma y timbre' }]
    : Array.from({ length: 8 }, (_, index) => ({ page: index + 1, text: `Texto de la página ${index + 1}` })) });
  const { client, calls } = fixture(scanned);
  const result = await runDocumentScan(client, job({ pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }));
  const model = (globalThis as any).__calls;
  assert.equal(model.length, 2);
  assert.equal(model[0].role, 'extract'); assert.equal(model[0].category, 'research');
  assert.equal(model[0].step, 'scan:doc:1,2,3,4,5,6,7,8');
  assert.deepEqual(model[0].attachments.map((file: any) => [file.kind, file.mediaType, file.data]), [['pdf', 'application/pdf', 'JVBERg==']]);
  assert.equal(model[0].attachmentTokens, 10 * 3000, 'every call reads the whole PDF');
  const inserts = calls.filter(call => call.table === 'opportunity_document_chunks' && call.op === 'insert');
  assert.equal(inserts[0].values[0].ordinal, 5, 'after the fragments the PDF already had');
  assert.equal(inserts[0].values[0].locator, 'Página 1 · leída por la IA');
  assert.equal(inserts[1].values.length, 1);
  const deletes = calls.filter(call => call.table === 'opportunity_document_chunks' && call.op === 'delete');
  assert.ok((deletes[1].filters.find(([column]) => column === 'locator')![1] as string[]).includes('Página 9 · leída por la IA'), 'a resumed group replaces its own text');
  const saved = calls.filter(call => call.table === 'opportunity_documents' && call.op === 'update').at(-1)!;
  assert.deepEqual(saved.values, { extraction_status: 'partial', pages_read: 9 });
  assert.deepEqual(result, { pages: 9, status: 'partial' });
});

test('a resumed job reads only the groups left, and stops before a call that would not fit in the tick', async () => {
  (globalThis as any).__calls = [];
  (globalThis as any).__answer = () => ({ pages: [{ page: 9, text: 'Anexo' }, { page: 10, text: 'Firma' }] });
  const done = { pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], done: [1, 2, 3, 4, 5, 6, 7, 8], missing: [] };
  assert.deepEqual(await runDocumentScan(fixture(scanned).client, job(done), Date.now() - 101_000), { waiting: true });
  assert.equal((globalThis as any).__calls.length, 0);
  const { client, calls } = fixture(scanned);
  assert.deepEqual(await runDocumentScan(client, job(done)), { pages: 10, status: 'read' });
  assert.equal((globalThis as any).__calls[0].step, 'scan:doc:9,10');
  assert.deepEqual(calls.filter(call => call.table === 'opportunity_documents' && call.op === 'update').at(-1)!.values, { extraction_status: 'read', pages_read: 10 });
});

test('a photo is one image call; a document already read, or deleted, is left alone', async () => {
  (globalThis as any).__calls = [];
  (globalThis as any).__answer = () => ({ pages: [{ page: 1, text: '[Captura de la tienda de Convenio Marco]\nGuardia 24/7 | $1.250.000' }] });
  const photo = { id: 'doc', name: '5-Captura_CM.png', mime: 'image/png', storage_path: 'org/op/doc/x.png', extraction_status: 'scan', pages_total: null };
  const { client, calls } = fixture(photo, null);
  assert.deepEqual(await runDocumentScan(client, job({ pages: [1] })), { pages: 1, status: 'read' });
  const call = (globalThis as any).__calls[0];
  assert.equal(call.attachments[0].kind, 'image'); assert.equal(call.attachmentTokens, 1800); assert.equal(call.output, 3000);
  const insert = calls.find(item => item.table === 'opportunity_document_chunks' && item.op === 'insert')!;
  assert.deepEqual(insert.values.map((chunk: any) => [chunk.ordinal, chunk.locator]), [[0, 'Imagen · leída por la IA']]);
  assert.deepEqual(calls.filter(item => item.table === 'opportunity_documents' && item.op === 'update').at(-1)!.values, { extraction_status: 'read' });
  (globalThis as any).__calls = [];
  assert.deepEqual(await runDocumentScan(fixture({ ...photo, extraction_status: 'read' }).client, job({ pages: [1] })), { pages: 0 });
  assert.deepEqual(await runDocumentScan(fixture(null).client, job({ pages: [1] })), { pages: 0 });
  assert.equal((globalThis as any).__calls.length, 0);
});

test('a report waits only for scans of its own opportunity still at work', async () => {
  const { client, calls } = fixture(null);
  (globalThis as any).__active = [{ id: 'scan-job' }];
  assert.equal(await activeDocumentScans(client, 'org', 'op'), true);
  assert.deepEqual(calls[0].filters, [['organization_id', 'org'], ['opportunity_id', 'op'], ['kind', 'evaluate'], ['dedupe_key', 'scan:%'], ['state', ['queued', 'running', 'waiting']]]);
  (globalThis as any).__active = [];
  assert.equal(await activeDocumentScans(client, 'org', 'op'), false);
});

test('a group the model did not finish leaves its pages unread; with nothing read the document keeps its status; a budget stop stops', async () => {
  (globalThis as any).__calls = [];
  (globalThis as any).__answer = (input: any) => input.step.endsWith('9,10') ? 'unfinished' : { pages: Array.from({ length: 8 }, (_, index) => ({ page: index + 1, text: 'Texto' })) };
  const { client, calls } = fixture(scanned);
  assert.deepEqual(await runDocumentScan(client, job({ pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })), { pages: 8, status: 'partial' });
  assert.deepEqual(calls.filter(call => call.table === 'opportunity_documents' && call.op === 'update').at(-1)!.values, { extraction_status: 'partial', pages_read: 8 });
  (globalThis as any).__answer = () => 'unfinished';
  const untouched = fixture(scanned);
  assert.deepEqual(await runDocumentScan(untouched.client, job({ pages: [1, 2] })), { pages: 0, status: 'scan' });
  assert.equal(untouched.calls.filter(call => call.table === 'opportunity_documents' && call.op === 'update').length, 0);
  (globalThis as any).__answer = () => 'budget';
  await assert.rejects(runDocumentScan(fixture(scanned).client, job({ pages: [1, 2] })), /presupuesto/);
});
