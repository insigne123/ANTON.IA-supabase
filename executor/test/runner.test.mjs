import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerArgs, collectOutputs, runJob } from '../lib/runner.mjs';

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
  assert.ok(argv.includes('/out:rw,noexec,nosuid,size=10m,nr_inodes=128,uid=65534,gid=65534'));
  assert.ok(!argv.includes('/o:/out:rw'), 'output cannot exhaust host disk');
  assert.ok(!argv.some(arg => String(arg).includes('sh') || String(arg).includes('&&')), 'no shell metacharacters');
  assert.ok(argv.includes('cowork-exec-py:1'));
  assert.ok(argv.includes('COWORK_JOB_TIMEOUT_MS=1000'), 'container watchdog survives supervisor loss');
});

test('failed code never publishes files; validation failures still remove container and workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runner-'));
  const removed = [];
  const job = { language: 'node', code: 'throw Error()', files: [], timeoutMs: 5000 };
  try {
    const result = await runJob(job, { baseDir: dir, docker: async () => ({ error: { code: 1 }, stdout: Buffer.from(''), stderr: Buffer.from('error'), durationMs: 1 }),
      dockerRm: async c => removed.push(c), decodeOutputs: () => assert.fail('failed outputs must remain quarantined') });
    assert.equal(result.status, 'failed'); assert.deepEqual(result.files, []); assert.equal(removed.length, 1);
    await assert.rejects(runJob(job, { baseDir: dir, docker: async () => ({ error: null, stdout: Buffer.from(''), stderr: Buffer.from(''), durationMs: 1 }),
      dockerRm: async c => removed.push(c), decodeOutputs: () => { throw new Error('too big'); } }), /too big/);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(dir), []); assert.equal(removed.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('output collection filters types and caps size', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'out-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'ok.csv'), 'a');
    await writeFile(join(dir, 'report.docx'), 'PK\x03\x04fake-docx');
    await writeFile(join(dir, 'slides.pptx'), 'PK\x03\x04fake-pptx');
    await writeFile(join(dir, 'bundle.zip'), 'PK\x03\x04fake-zip');
    await writeFile(join(dir, 'evil.sh'), 'x');
    await writeFile(join(dir, '.hidden.csv'), 'x');
    const files = await collectOutputs(dir);
    assert.deepEqual(files.map(file => file.name).sort(), ['bundle.zip', 'ok.csv', 'report.docx', 'slides.pptx']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
