import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerArgs, collectOutputs } from '../lib/runner.mjs';

test('docker argv denies network, caps resources and drops privileges', () => {
  const argv = dockerArgs({ container: 'c', workDir: '/w', outDir: '/o', language: 'python', timeoutMs: 1000 });
  const has = (...xs) => xs.every(x => argv.includes(x));
  assert.ok(has('--network', 'none'));
  assert.ok(has('--memory=2g', '--memory-swap=2g'));
  assert.ok(has('--cpus=1.0'));
  assert.ok(has('--pids-limit=128'));
  assert.ok(has('--read-only'));
  assert.ok(has('--cap-drop=ALL'));
  assert.ok(has('--security-opt=no-new-privileges:true'));
  assert.ok(has('--user', '65534:65534'));
  assert.ok(has('--rm'));
  assert.ok(!argv.some(arg => String(arg).includes('sh') || String(arg).includes('&&')), 'no shell metacharacters');
  assert.ok(argv.includes('cowork-exec-py:1'));
});

test('output collection filters types and caps size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'out-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'ok.csv'), 'a');
    await writeFile(join(dir, 'evil.sh'), 'x');
    await writeFile(join(dir, '.hidden.csv'), 'x');
    const files = await collectOutputs(dir);
    assert.deepEqual(files.map(file => file.name), ['ok.csv']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
