import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkPublishedFiles } from './published-files';
import type { CoworkEvent } from './contracts';
test('uploads and failed/stale attempts never publish; only the fenced complete manifest does', () => {
  const file = { name: 'report.pdf', size: 100, sha256: 'a'.repeat(64) };
  const event = (kind: string, payload: Record<string, unknown>) => ({ kind, payload, sequence: 1, created_at: '2026-10-09T00:00:00Z' }) as CoworkEvent;
  assert.deepEqual(coworkPublishedFiles([event('artifact.created', { ...file, codeHash: 'b'.repeat(64) }),
    event('effect.failed', { kind: 'code_execute', result: { files: [file] } })]), []);
  const published = coworkPublishedFiles([event('effect.completed', { kind: 'code_execute', result: { files: [file, { ...file, name: '../escape' }] } })]);
  assert.equal(published.length, 1); assert.equal(published[0].sha256, file.sha256);
});
