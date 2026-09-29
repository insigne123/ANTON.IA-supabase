// API contract test of POST /api/cowork/export with isolated authorization. No environment or production access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const authState = { denied: false };
globalThis.__coworkBlockExportTest = authState;
const result = await build({
  entryPoints: ['src/app/api/cowork/export/route.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-route-dependencies', setup(build) {
    build.onResolve({ filter: /^next\/server$|^@\/lib\/server\/(cowork\/access|auth-utils)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'next/server') return { contents: 'export const NextResponse = Response;' };
      if (args.path.endsWith('auth-utils')) return { contents: 'export class AuthError extends Error {} export function handleAuthError(){return Response.json({error:"Forbidden"},{status:403})}' };
      return { contents: 'import {AuthError} from "@/lib/server/auth-utils"; export async function requireCoworkAccess(){if(globalThis.__coworkBlockExportTest.denied)throw new AuthError();return {user:{id:"owner"},organizationId:"org"};}' };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);

const LIMIT = 2 * 1024 * 1024; // COWORK_EXPORT_BODY_LIMIT in block-export.ts
const table = { type: 'table', title: 'Contactos de RR. HH.', columns: ['Nombre', 'Correo'], rows: [['Felipe Muñoz', 'fmunoz@securitas.cl'], ['=1+1', '']] };
const email = { type: 'email_draft', title: 'Correo para Felipe', to: ['Felipe Muñoz'], subject: 'Asunto que edité yo', body: 'Hola Felipe,\n\nCuerpo editado.\n\nNicolás' };
const post = body => new Request('http://localhost/api/cowork/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
/** A request that counts whether anything read its body. */
const counted = (headers = {}) => {
  const state = { reads: 0 };
  return { state, request: { headers: new Headers(headers), get body() { state.reads++; return null; } } };
};
try {
  // Access first: a request without it is refused before its body is read.
  authState.denied = true;
  const denied = counted();
  const refused = await module.exports.POST(denied.request);
  assert.equal(refused.status, 403);
  assert.match(refused.headers.get('cache-control'), /private, no-store/);
  assert.equal(denied.state.reads, 0);
  authState.denied = false;

  // A table as Excel: a private download named after the card.
  const sheet = await module.exports.POST(post({ format: 'xlsx', block: table }));
  assert.equal(sheet.status, 200);
  assert.equal(sheet.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(sheet.headers.get('content-disposition'), /^attachment; filename="contactos-de-rr-hh\.xlsx"$/);
  assert.match(sheet.headers.get('cache-control'), /private, no-store/);
  assert.equal(sheet.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual([...new Uint8Array(await sheet.arrayBuffer()).slice(0, 2)], [0x50, 0x4B], 'an .xlsx is a ZIP');

  // The email as the person sent it (their edit), as Word.
  const word = await module.exports.POST(post({ format: 'docx', block: email }));
  assert.equal(word.status, 200);
  assert.equal(word.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(word.headers.get('content-disposition'), /filename="correo-para-felipe\.docx"/);

  // What cannot be made is refused with a reason, never with a stack.
  const broken = await module.exports.POST(post('esto no es JSON'));
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { error: 'La solicitud no es válida.' });
  assert.equal((await module.exports.POST(post({ format: 'xlsx', block: email }))).status, 400);
  assert.equal((await module.exports.POST(post({ format: 'md', block: table }))).status, 400);
  const glyphs = await module.exports.POST(post({ format: 'pdf', block: { ...email, body: 'Con emoji 🌍' } }));
  assert.equal(glyphs.status, 422);
  assert.match((await glyphs.json()).error, /Word/);

  // Too big: by its declared length without reading it, or while it streams in.
  const declared = counted({ 'content-length': String(LIMIT + 1) });
  assert.equal((await module.exports.POST(declared.request)).status, 413);
  assert.equal(declared.state.reads, 0);
  let cancelled = false;
  const chunk = new Uint8Array(256 * 1024).fill(0x20);
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) { if (sent > LIMIT * 2) return controller.close(); sent += chunk.length; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  const streamed = await module.exports.POST(new Request('http://localhost/api/cowork/export', { method: 'POST', body: stream, duplex: 'half' }));
  assert.equal(streamed.status, 413);
  assert.ok(cancelled, 'the rest of an oversized body is not read');
  assert.ok(sent <= LIMIT + chunk.length * 2, 'reading stops at the limit');
  console.log('PASS: access before the body, private downloads named after the card, edited text kept, refusals with reasons and bounded bodies.');
} finally { delete globalThis.__coworkBlockExportTest; }
