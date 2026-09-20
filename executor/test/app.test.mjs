import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResultStore } from '../lib/store.mjs';
import { createApp } from '../lib/app.mjs';

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  try {
    const store = createResultStore({ dir, ttlMs: 50, maxEntries: 2, maxBytes: 300 });
    await store.init();
    await fn(store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('set/get round-trips and expires', async () => {
  await withStore(async store => {
    await store.set('key-1234', { requestHash: 'abc', result: { status: 'completed' } });
    const hit = await store.get('key-1234');
    assert.equal(hit.result.status, 'completed');
    assert.equal(hit.requestHash, 'abc');
    assert.equal(hit.reused, true);
    await new Promise(resolve => setTimeout(resolve, 70));
    assert.equal(await store.get('key-1234'), null);
  });
});

test('prunes oldest beyond count and size caps', async () => {
  await withStore(async (store, dir) => {
    await store.set('key-aaaa', { requestHash: 'a', result: { v: 'x'.repeat(200) } });
    await store.set('key-bbbb', { requestHash: 'b', result: { v: 'y'.repeat(200) } });
    await store.set('key-cccc', { requestHash: 'c', result: { v: 'z' } });
    assert.equal(await store.get('key-aaaa'), null);
    assert.notEqual(await store.get('key-cccc'), null);
    void dir;
  });
});

function post(port, path, body, auth = 'Bearer s3cret') {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const req = request({ host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth, 'content-length': Buffer.byteLength(payload) } },
        res => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
        });
      req.on('error', reject);
      req.end(payload);
    });
  });
}

test('app: auth, replay, busy and validation', async () => {
  await withStore(async store => {
    const dir = await mkdtemp(join(tmpdir(), 'secret-'));
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, 'secret'), 's3cret\n', { mode: 0o600 });
      let runs = 0;
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const run = async job => {
        runs++;
        if (job.code === 'slow') await gate;
        return { status: 'completed', durationMs: 1 };
      };
      const server = createApp({ store, config: { secretFile: join(dir, 'secret'), baseDir: '/tmp' }, run });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      try {
        const denied = await post(port, '/v1/jobs', {}, 'Bearer wrong');
        assert.equal(denied.status, 401);
        const bad = await post(port, '/v1/jobs', { idempotencyKey: 'key-1234', language: 'ruby', code: 'x' });
        assert.equal(bad.status, 422);
        const first = await post(port, '/v1/jobs', { idempotencyKey: 'key-1234', language: 'python', code: 'print(1)' });
        assert.equal(first.status, 200);
        assert.equal(first.body.reused, false);
        assert.equal(runs, 1);
        const replay = await post(port, '/v1/jobs', { idempotencyKey: 'key-1234', language: 'python', code: 'print(1)' });
        assert.equal(replay.status, 200);
        assert.equal(replay.body.reused, true);
        assert.equal(runs, 1, 'replay must not re-execute');
        const conflict = await post(port, '/v1/jobs', { idempotencyKey: 'key-1234', language: 'python', code: 'print(2)' });
        assert.equal(conflict.status, 409);
        assert.equal(runs, 1, 'conflict must not execute either');
        const slow = post(port, '/v1/jobs', { idempotencyKey: 'key-slow-1', language: 'python', code: 'slow' });
        await new Promise(resolve => setTimeout(resolve, 50));
        const busyRes = await post(port, '/v1/jobs', { idempotencyKey: 'key-slow-2', language: 'python', code: 'x' });
        assert.equal(busyRes.status, 409);
        release();
        assert.equal((await slow).status, 200);
      } finally {
        release();
        server.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
