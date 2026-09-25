// API contract test with isolated authorization/storage. No environment or production access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const authState = { denied: false, reads: 0, auth: { user: { id: 'owner' }, organizationId: 'org' } };
globalThis.__coworkExportTest = authState;
const result = await build({
  entryPoints: ['src/app/api/cowork/runs/[id]/export/route.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-route-dependencies', setup(build) {
    build.onResolve({ filter: /^next\/server$|^@\/lib\/server\/(cowork\/access|cowork\/runs|auth-utils)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'next/server') return { contents: 'export const NextResponse = Response;' };
      if (args.path.endsWith('auth-utils')) return { contents: 'export class AuthError extends Error {} export function handleAuthError(){return Response.json({error:"Forbidden"},{status:403})}' };
      if (args.path.endsWith('/access')) return { contents: 'import {AuthError} from "@/lib/server/auth-utils"; export async function requireCoworkAccess(){if(globalThis.__coworkExportTest.denied)throw new AuthError();return globalThis.__coworkExportTest.auth;}' };
      return { contents: `export async function getCoworkRun(auth,id){
        globalThis.__coworkExportTest.reads++;
        if(auth!==globalThis.__coworkExportTest.auth)throw new Error('Missing scope');
        if(id==='missing')return null;
        return {events:[{kind:'run.completed',payload:{reply:'Listo',document:{title:'Informe',content:'Contenido privado'}}}]};
      }` };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const request = format => ({ nextUrl: new URL(`http://localhost/api/cowork/runs/run/export?format=${format}`) });
const context = id => ({ params: Promise.resolve({ id }) });
try {
  authState.denied = true;
  assert.equal((await module.exports.GET(request('md'), context('run'))).status, 403);
  assert.equal(authState.reads, 0);
  authState.denied = false;
  const response = await module.exports.GET(request('md'), context('run'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.match(response.headers.get('content-disposition'), /filename="informe\.md"/);
  assert.equal(await response.text(), 'Contenido privado');
  assert.equal((await module.exports.GET(request('md'), context('missing'))).status, 404);
  const before = authState.reads;
  assert.equal((await module.exports.GET(request('html'), context('run'))).status, 400);
  assert.equal(authState.reads, before);
  assert.equal((await module.exports.GET(request('xlsx'), context('run'))).status, 404);
  console.log('PASS: authorization before reads, scoped lookup, private download, missing result and format validation.');
} finally { delete globalThis.__coworkExportTest; }
