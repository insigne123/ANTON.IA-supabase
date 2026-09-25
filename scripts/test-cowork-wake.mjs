// API contract test for the inline worker wake. Isolated: no environment, database or providers.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const state = { denied: false, configured: true, queue: [], calls: 0, gate: null };
globalThis.__coworkWakeTest = state;
const result = await build({
  entryPoints: ['src/app/api/cowork/wake/route.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-route-dependencies', setup(build) {
    build.onResolve({ filter: /^next\/server$|^@\/lib\/server\/(cowork\/access|cowork\/runs|cowork\/worker|auth-utils)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      if (args.path === 'next/server') return { contents: 'export const NextResponse = Response;' };
      if (args.path.endsWith('auth-utils')) return { contents: 'export class AuthError extends Error {} export function handleAuthError(){return Response.json({error:"Forbidden"},{status:403})}' };
      if (args.path.endsWith('/access')) return { contents: 'import {AuthError} from "@/lib/server/auth-utils"; export async function requireCoworkAccess(){if(globalThis.__coworkWakeTest.denied)throw new AuthError();return {user:{id:"owner"},organizationId:"org"};}' };
      if (args.path.endsWith('/runs')) return { contents: 'export function coworkWorkerConfigured(){return globalThis.__coworkWakeTest.configured;}' };
      return { contents: `export async function processCoworkQueue(){
        const test = globalThis.__coworkWakeTest; test.calls++;
        if (test.gate) await test.gate;
        return { processed: test.queue.shift() ? 1 : 0 };
      }` };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
const wake = () => module.exports.POST();
try {
  state.denied = true;
  assert.equal((await wake()).status, 403);
  assert.equal(state.calls, 0, 'authorization happens before any worker call');
  state.denied = false;

  state.configured = false;
  assert.deepEqual(await (await wake()).json(), { woken: false });
  assert.equal(state.calls, 0, 'unconfigured worker is never invoked');
  state.configured = true;

  process.env.COWORK_INLINE_WAKE = 'false';
  assert.deepEqual(await (await wake()).json(), { woken: false });
  assert.equal(state.calls, 0, 'kill switch disables inline processing');
  delete process.env.COWORK_INLINE_WAKE;

  state.queue = [1, 1, 1, 1, 1];
  const drained = await (await wake()).json();
  assert.deepEqual(drained, { woken: true, processed: 3 }, 'drains a short chain, bounded to three steps');

  state.calls = 0; state.queue = [1];
  let release;
  state.gate = new Promise(resolve => { release = resolve; });
  const first = wake();
  await new Promise(resolve => setTimeout(resolve, 10));
  const second = await (await wake()).json();
  assert.deepEqual(second, { woken: false, busy: true }, 'one wake at a time per instance');
  release(); state.gate = null;
  assert.equal((await (await first).json()).woken, true);
  assert.equal(state.calls, 2, 'the busy request did not start another worker call');
  console.log('PASS: owner-only wake, kill switch, unconfigured guard, bounded drain and single flight.');
} finally { delete globalThis.__coworkWakeTest; }
