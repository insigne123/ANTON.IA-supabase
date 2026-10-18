import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// «Documentos de la empresa» with the database and Storage in memory.
async function load() {
  const stubs: Record<string, string> = {
    '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
    './workspace-access': `export async function assertOpportunityRead(){} export async function readableOpportunityIds(){ return null }
      export function assertOpportunityAdmin(scope){ if (!['admin','owner'].includes(scope.role)) { const e = new Error('Esta acción corresponde a un administrador.'); e.status = 403; throw e; } }`,
  };
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-company-documents';`, loader: 'ts', resolveDir: process.cwd() },
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

function memory(options: { failInsert?: boolean; missing?: boolean } = {}) {
  let serial = 0;
  const rows: any[] = []; const files = new Map<string, Uint8Array>(); const removed: string[] = [];
  const query = () => {
    const filters: Array<(row: any) => boolean> = [];
    let action: { kind: string; values?: any } = { kind: 'select' };
    const run = () => {
      if (options.missing) return { data: null, error: { code: '42P01', message: 'missing' } };
      const match = (row: any) => filters.every(filter => filter(row));
      if (action.kind === 'insert') {
        if (options.failInsert) return { data: null, error: { code: '23514', message: 'check' } };
        const row = { id: `doc-${++serial}`, created_at: '2026-10-18T12:00:00Z', ...action.values }; rows.push(row); return { data: [row], error: null };
      }
      if (action.kind === 'update') { const hit = rows.filter(match); hit.forEach(row => Object.assign(row, action.values)); return { data: hit, error: null }; }
      if (action.kind === 'delete') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1); return { data: null, error: null }; }
      return { data: rows.filter(match), error: null };
    };
    const first = () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; };
    const builder: any = {
      select: () => builder, insert: (values: any) => { action = { kind: 'insert', values }; return builder; },
      update: (values: any) => { action = { kind: 'update', values }; return builder; }, delete: () => { action = { kind: 'delete' }; return builder; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
      order: () => builder, limit: () => builder, maybeSingle: async () => first(),
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  };
  const storage = { from: () => ({
    upload: async (path: string, bytes: Uint8Array) => { files.set(path, bytes); return { data: { path }, error: null }; },
    remove: async (paths: string[]) => { removed.push(...paths); paths.forEach(path => files.delete(path)); return { data: null, error: null }; },
    download: async (path: string) => files.has(path) ? { data: new Blob([files.get(path)!]), error: null } : { data: null, error: { message: 'missing' } },
  }) };
  return { rows, files, removed, client: { from: query, storage } as any };
}
const admin = { organizationId: 'org', userId: 'a1', role: 'admin' };
const pdf = (name = 'F30 octubre.pdf') => ({ name, bytes: new Uint8Array(Buffer.from('%PDF-1.7 certificado')) });

test('an admin adds a PDF with its expiry; it is stored under the workspace and listed', async () => {
  const { addCompanyDocument, listCompanyDocuments } = await load();
  const { rows, files, client } = memory();
  const saved = await addCompanyDocument(client, admin, { kind: 'f30', label: 'Certificado F30', expiresAt: '2026-10-31', file: pdf('Certificado F30 – octubre.pdf') });
  assert.deepEqual([saved.kind, saved.label, saved.expiresAt, saved.fileName], ['f30', 'Certificado F30', '2026-10-31', 'Certificado F30 – octubre.pdf']);
  assert.match(rows[0].storage_path, /^company\/org\/[0-9a-f-]{36}-Certificado F30 _ octubre\.pdf$/);
  assert.equal(files.size, 1);
  assert.equal(rows[0].mime, 'application/pdf');
  assert.deepEqual((await listCompanyDocuments(client, 'org')).documents.map((doc: any) => doc.label), ['Certificado F30']);
  assert.deepEqual(await listCompanyDocuments(memory({ missing: true }).client, 'org'), { available: false, documents: [] });
});

test('only admins add, renew and remove; a file that is not what it says is refused; a failed row leaves no file', async () => {
  const { addCompanyDocument, updateCompanyDocument, deleteCompanyDocument } = await load();
  const { rows, removed, client } = memory();
  await assert.rejects(addCompanyDocument(client, { ...admin, role: 'member' }, { kind: 'f30', label: 'F30', expiresAt: null, file: pdf() }), (error: any) => error.status === 403);
  await assert.rejects(addCompanyDocument(client, admin, { kind: 'f30', label: 'F30', expiresAt: null, file: { name: 'f30.pdf', bytes: new Uint8Array(Buffer.from('<html>')) } }), /PDF o Word/);
  await assert.rejects(addCompanyDocument(client, admin, { kind: 'f30', label: 'F30', expiresAt: null, file: { name: 'f30.exe', bytes: new Uint8Array(Buffer.from('%PDF-')) } }), /PDF o Word/);
  await assert.rejects(addCompanyDocument(client, admin, { kind: 'licencia', label: 'X', expiresAt: null, file: pdf() }));
  const broken = memory({ failInsert: true });
  await assert.rejects(addCompanyDocument(broken.client, admin, { kind: 'f30', label: 'F30', expiresAt: null, file: pdf() }), /No se pudo guardar el documento/);
  assert.equal(broken.files.size, 0, 'the uploaded file is removed again');
  const saved = await addCompanyDocument(client, admin, { kind: 'f30', label: 'F30', expiresAt: '2026-10-31', file: pdf() });
  const renewed = await updateCompanyDocument(client, admin, saved.id, { kind: 'f30', label: 'F30 noviembre', expiresAt: '2026-11-30' });
  assert.deepEqual([renewed.label, renewed.expiresAt], ['F30 noviembre', '2026-11-30']);
  await assert.rejects(updateCompanyDocument(client, { ...admin, role: 'member' }, saved.id, { kind: 'f30', label: 'X', expiresAt: null }), (error: any) => error.status === 403);
  await deleteCompanyDocument(client, admin, saved.id);
  assert.equal(rows.length, 0);
  assert.equal(removed.length, 1, 'its file goes too');
  await assert.rejects(deleteCompanyDocument(client, admin, saved.id), (error: any) => error.status === 404);
});

test('anyone of the workspace downloads a document of their own workspace only', async () => {
  const { addCompanyDocument, downloadCompanyDocument } = await load();
  const { client } = memory();
  const saved = await addCompanyDocument(client, admin, { kind: 'iso', label: 'ISO 9001', expiresAt: null, file: pdf('ISO 9001.pdf') });
  const file = await downloadCompanyDocument(client, { organizationId: 'org', userId: 'm1', role: 'member' }, saved.id);
  assert.deepEqual([file.name, file.mime, Buffer.from(file.bytes).toString('latin1').slice(0, 5)], ['ISO 9001.pdf', 'application/pdf', '%PDF-']);
  await assert.rejects(downloadCompanyDocument(client, { organizationId: 'other', userId: 'x', role: 'admin' }, saved.id), (error: any) => error.status === 404);
});
