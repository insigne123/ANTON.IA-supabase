import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The wake route with Cowork's access and queue in memory: it answers before the hosting front's 30 s cut.
async function load() {
  const stubs: Record<string, string> = {
    'next/server': 'export const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };',
    '@/lib/server/cowork/access': 'export async function requireCoworkAccess(){ return {} }',
    '@/lib/server/auth-utils': 'export class AuthError extends Error {} export function handleAuthError(){ return { status: 401 } }',
    '@/lib/server/cowork/runs': 'export function coworkWorkerConfigured(){ return true }',
    '@/lib/server/cowork/worker': 'export function processCoworkQueue(){ return globalThis.__queue() }',
  };
  const bundle = await build({
    stdin: { contents: `export { POST } from './src/app/api/cowork/wake/route';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^(next\/server|@\/lib\/server\/(cowork\/access|auth-utils|cowork\/runs|cowork\/worker))$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[args.path] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports as { POST: () => Promise<{ body: any; status: number }> };
}

test('a quick step answers with what it did', async () => {
  const { POST } = await load();
  let calls = 0;
  (globalThis as any).__queue = async () => ({ processed: calls++ === 0 ? 1 : 0 });
  assert.deepEqual(await POST(), { body: { woken: true, processed: 1 }, status: 200 });
});

test('a long step gets an answer at 25 s and keeps running; a second wake finds it busy', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { POST } = await load();
    let finish: (value: { processed: number }) => void = () => {};
    (globalThis as any).__queue = () => new Promise(resolve => { finish = resolve; });
    const first = POST();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await POST(), { body: { woken: false, busy: true }, status: 202 });
    mock.timers.tick(25_000);
    assert.deepEqual(await first, { body: { woken: true, working: true }, status: 202 }, 'before the 30 s cut');
    // Still running after the answer: another wake does not start a second drain.
    assert.deepEqual(await POST(), { body: { woken: false, busy: true }, status: 202 });
    finish({ processed: 0 });
    await new Promise(resolve => setImmediate(resolve));
    (globalThis as any).__queue = async () => ({ processed: 0 });
    assert.deepEqual(await POST(), { body: { woken: true, processed: 0 }, status: 200 });
  } finally {
    mock.timers.reset();
  }
});

test('a step that fails after the answer does not leave an unhandled rejection or a stuck lock', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const unhandled: unknown[] = [];
  const listen = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', listen);
  try {
    const { POST } = await load();
    let fail: (error: Error) => void = () => {};
    (globalThis as any).__queue = () => new Promise((_, reject) => { fail = reject; });
    const first = POST();
    await new Promise(resolve => setImmediate(resolve));
    mock.timers.tick(25_000);
    assert.equal((await first).status, 202);
    fail(new Error('model timeout'));
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
    (globalThis as any).__queue = async () => ({ processed: 0 });
    assert.equal((await POST()).body.woken, true, 'the lock was released');
  } finally {
    process.off('unhandledRejection', listen);
    mock.timers.reset();
  }
});
