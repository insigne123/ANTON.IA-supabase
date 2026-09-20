// API contract test for artifact download vs isolated preview. No environment or production access.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const state = { denied: false, reads: 0, downloads: 0 };
globalThis.__coworkArtifactTest = state;
const result = await build({
  entryPoints: ['src/app/api/cowork/runs/[id]/artifacts/route.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-route-dependencies', setup(build) {
    build.onResolve({ filter: /^next\/server$|^@\/lib\/server\/(cowork\/access|cowork\/runs|auth-utils|supabase-admin)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'next/server') return { contents: 'export const NextResponse = Response;' };
      if (args.path.endsWith('auth-utils')) return { contents: 'export class AuthError extends Error {} export function handleAuthError(){return Response.json({error:"Forbidden"},{status:403})}' };
      if (args.path.endsWith('/access')) return { contents: 'import {AuthError} from "@/lib/server/auth-utils"; export async function requireCoworkAccess(){if(globalThis.__coworkArtifactTest.denied)throw new AuthError();return {user:{id:"owner"},organizationId:"org"};}' };
      if (args.path.endsWith('/runs')) return { contents: `export async function getCoworkRun(auth,id){
        globalThis.__coworkArtifactTest.reads++;
        if(id==='missing')return null;
        return {run:{id},events:[
          {kind:'artifact.created',payload:{name:'informe.html',size:42}},
          {kind:'artifact.created',payload:{name:'datos.csv',size:10}}]};
      }` };
      return { contents: `export function getSupabaseAdminClient(){return {storage:{from:()=>({download:async()=>{
        globalThis.__coworkArtifactTest.downloads++;
        return {data:{arrayBuffer:async()=>Buffer.from('<html><body>Hola</body></html>')},error:null};}})}};}` };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const request = (name, view) => ({ nextUrl: new URL(`http://localhost/api/cowork/runs/run/artifacts?name=${name}${view ? '&view=1' : ''}`) });
const context = id => ({ params: Promise.resolve({ id }) });
try {
  state.denied = true;
  assert.equal((await module.exports.GET(request('informe.html'), context('run'))).status, 403);
  assert.equal(state.reads, 0);
  state.denied = false;
  // Default stays a private download.
  const download = await module.exports.GET(request('datos.csv'), context('run'));
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.match(download.headers.get('content-type'), /text\/csv/);
  // HTML preview is inline, sandboxed, same-origin embed only.
  const preview = await module.exports.GET(request('informe.html', true), context('run'));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('content-disposition'), null);
  assert.match(preview.headers.get('content-type'), /text\/html/);
  assert.match(preview.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.match(preview.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(preview.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(preview.headers.get('cache-control'), /private, no-store/);
  assert.equal(await preview.text(), '<html><body>Hola</body></html>');
  // Non-viewable formats never render inline, even with view=1.
  const csvView = await module.exports.GET(request('datos.csv', true), context('run'));
  assert.match(csvView.headers.get('content-disposition'), /attachment/);
  // Only recorded artifacts resolve.
  assert.equal((await module.exports.GET(request('otro.html'), context('run'))).status, 404);
  assert.equal((await module.exports.GET(request('informe.html'), context('missing'))).status, 404);
  console.log('PASS: private download default, sandboxed HTML preview, view allowlist and recorded-only artifacts.');
} finally { delete globalThis.__coworkArtifactTest; }
