import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const bundle = await build({ entryPoints: ['functions/cowork-scheduler.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'firebase-fixture', setup(build) {
    build.onResolve({ filter: /^firebase-functions\/v2$/ }, () => ({ path: 'firebase', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const scheduler={onSchedule:(options,handler)=>({options,handler})};' }));
  } }],
});
const module = { exports: {} };
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const { invokeCoworkWorker, coworkTick } = module.exports;
let calls = 0;
const fakeFetch = async (url, options) => {
  calls++;
  assert.equal(String(url), 'https://app.example/api/cron/cowork');
  assert.equal(options.headers['x-cowork-worker-secret'], 'fixture-secret');
  assert.equal(options.redirect, 'error');
  assert.equal(options.method, 'POST');
  return { ok: true };
};
assert.deepEqual(await invokeCoworkWorker({}, fakeFetch), { skipped: true });
const environment = { COWORK_SCHEDULER_ENABLED: 'true', COWORK_WORKER_SECRET: 'fixture-secret', ANTONIA_APP_URL: 'https://app.example' };
await invokeCoworkWorker(environment, fakeFetch);
await assert.rejects(invokeCoworkWorker({ ...environment, COWORK_WORKER_SECRET: '' }, fakeFetch), /secret/);
await assert.rejects(invokeCoworkWorker({ ...environment, ANTONIA_APP_URL: 'http://app.example' }, fakeFetch), /origin/);
await assert.rejects(invokeCoworkWorker(environment, async () => ({ ok: false, status: 503 })), /503/);
assert.equal(calls, 1);
assert.equal(coworkTick.options.retryCount, 0);
assert.deepEqual(coworkTick.options.secrets, ['COWORK_WORKER_SECRET']);
console.log('PASS: private scheduler gating, dedicated secret, HTTPS, redirects rejected and no automatic scheduler retries.');
