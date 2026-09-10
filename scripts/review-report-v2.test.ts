import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

for (const [args, error] of [
  [['--replay', 'missing-replay'], /Paid model\/search calls require --allow-paid-calls/],
  [['--production-read-only'], /Paid model\/search calls require --allow-paid-calls/],
  [['--production-read-only', '--inspect-context'], /--inspect-context requires --replay/],
  [['--replay', 'missing-replay', '--inspect-context'], /ENOENT/],
] as const) {
  test(`review CLI fails without network or exports: ${args.join(' ')}`, () => {
    const output = path.join(tmpdir(), `report-v2-no-write-${randomUUID()}`);
    const result = spawnSync(process.execPath, [
      '--loader', './scripts/ts-test-loader.mjs', 'scripts/review-report-v2.ts', ...args, '--output', output,
    ], { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NODE_ENV: 'test' } });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
    assert.equal(existsSync(output), false);
  });
}
