import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import JSZip from 'jszip';

// A received e-mail uploaded to the expediente (OPP-49), with the database and the storage in memory.
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

const loaded = load(`export { saveOpportunityDocument, saveOpportunityMail } from './src/lib/server/commercial-opportunities/workspace-documents';`, {
  '@/lib/server/auth-utils': 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}',
  './workspace-access': 'export async function assertOpportunityRead(){}',
  './workspace-store': 'export function opportunityDb(result){ if (result && result.error) throw result.error; return result ? result.data ?? null : null }',
});

/** The expediente: the documents already in it, and each one saved, by name. */
function expediente(already = 0) {
  const names: string[] = Array.from({ length: already }, (_, index) => `Documento ${index + 1}.pdf`);
  const from = (table: string) => {
    let head = false;
    const chain: any = {
      select: (_columns: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return chain; },
      insert: (row: { name?: string }) => { if (table === 'opportunity_documents' && row.name) names.push(row.name); return chain; },
      update: () => chain, upsert: () => chain, eq: () => chain, maybeSingle: () => chain, single: () => chain,
      then: (resolve: (value: unknown) => void) => resolve(head ? { count: names.length, error: null } : { data: null, error: null }),
    };
    return chain;
  };
  return { names, client: { from, storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) } } };
}

const scope = { organizationId: 'org-1', userId: 'user-1', role: 'admin' };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
const attachment = (name: string, type: string, bytes: Buffer) => ['--mix', `Content-Type: ${type}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`,
  'Content-Transfer-Encoding: base64', '', bytes.toString('base64')];
async function invitation() {
  const archive = new JSZip();
  archive.file('Anexo 1.pdf', pdf);
  archive.file('plano.dwg', Buffer.from('dwg'));
  const annexes = Buffer.from(await archive.generateAsync({ type: 'uint8array' }));
  return new TextEncoder().encode(['From: compras@muni.cl', 'Subject: Invitación guardias', 'Content-Type: multipart/mixed; boundary="mix"', '',
    '--mix', 'Content-Type: text/plain; charset=utf-8', '', 'Los invitamos a cotizar guardias para 3 recintos.',
    ...attachment('Bases.pdf', 'application/pdf', pdf), ...attachment('Anexos.zip', 'application/zip', annexes),
    ...attachment('Planos.rar', 'application/x-rar-compressed', Buffer.from('rar')), '--mix--', ''].join('\r\n'));
}

test('an e-mail goes into the expediente as its message and each document it brings, and the note names what stayed out', async () => {
  const { saveOpportunityMail, saveOpportunityDocument } = await loaded;
  const { names, client } = expediente();
  const saved = await saveOpportunityMail(client, scope, 'op-1', { name: 'Invitación.eml', bytes: await invitation(), sourceKind: 'upload' });
  assert.deepEqual(names, ['Correo - Invitación guardias.txt', 'Bases.pdf', 'Anexo 1.pdf']);
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.equal(saved.note, 'Guardamos el mensaje y 2 documentos adjuntos. «Anexos.zip»: Del ZIP tomamos 1 documento. «plano.dwg» no es un formato que podamos leer.'
    + ' «Planos.rar»: Es otro comprimido (RAR o 7z): descomprímelo y sube lo que trae.');
  // Saved as a document (the assistant, the research), an e-mail goes in the same way.
  const again = expediente();
  assert.match(await saveOpportunityDocument(again.client, scope, 'op-1', { name: 'Invitación.eml', bytes: await invitation(), sourceKind: 'upload' }), /^[0-9a-f-]{36}$/);
  assert.deepEqual(again.names, names);
});

test('when the expediente fills up, the message goes in and the note says which attachments did not', async () => {
  const { saveOpportunityMail } = await loaded;
  const { names, client } = expediente(39);
  const saved = await saveOpportunityMail(client, scope, 'op-1', { name: 'Invitación.eml', bytes: await invitation(), sourceKind: 'upload' });
  assert.equal(names.at(-1), 'Correo - Invitación guardias.txt');
  assert.equal(names.length, 40);
  assert.match(saved.note, /^Guardamos el mensaje\. «Anexos\.zip»: .+ «Bases\.pdf»: El expediente admite hasta 40 documentos por versión de trabajo\. «Anexo 1\.pdf»: El expediente admite hasta 40 documentos/);
});

test('an e-mail that cannot be opened is a clear error, and nothing is saved', async () => {
  const { saveOpportunityMail } = await loaded;
  const { names, client } = expediente();
  await assert.rejects(saveOpportunityMail(client, scope, 'op-1', { name: 'roto.msg', bytes: new Uint8Array([1, 2, 3]), sourceKind: 'upload' }),
    (error: Error & { status?: number }) => error.status === 422 && /«roto\.msg» no se pudo abrir como correo/.test(error.message));
  assert.deepEqual(names, []);
});
