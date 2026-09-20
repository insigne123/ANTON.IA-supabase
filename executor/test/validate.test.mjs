import assert from 'node:assert/strict';
import test from 'node:test';
import { validateJob, hashJobRequest } from '../lib/validate.mjs';

const key = 'test-key-1234';

test('rejects unknown language, oversized code and bad keys', () => {
  assert.throws(() => validateJob({ idempotencyKey: 'x', language: 'python', code: 'x' }), /idempotencyKey/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'ruby', code: 'x' }), /language/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: 'x'.repeat(65537) }), /64 KB/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: '' }), /non-empty/);
});

test('rejects traversal, hidden files, archives and duplicates', () => {
  const file = name => ({ name, contentBase64: Buffer.from('a').toString('base64') });
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: 'x', files: [file('../evil.py')] }), /Invalid/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: 'x', files: [file('.hidden')] }), /Hidden/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: 'x', files: [file('a.zip')] }), /Extension/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: 'x', files: [file('a.csv'), file('a.csv')] }), /Duplicate/);
  assert.throws(() => validateJob({ idempotencyKey: key, language: 'python', code: 'x', files: Array.from({ length: 9 }, (_, i) => file(`a${i}.csv`)) }), /At most 8/);
});

test('accepts a well-formed job with defaults', () => {
  const job = validateJob({ idempotencyKey: key, language: 'node',
    code: 'console.log(1)',
    files: [{ name: 'in.csv', contentBase64: Buffer.from('a,b').toString('base64') }] });
  assert.equal(job.timeoutMs, 120000);
  assert.equal(job.files.length, 1);
  assert.equal(job.files[0].bytes.toString(), 'a,b');
});

test('request hash is stable and sensitive to content', () => {
  const base = validateJob({ idempotencyKey: key, language: 'python', code: 'print(1)', files: [] });
  assert.equal(hashJobRequest(base), hashJobRequest(validateJob({ idempotencyKey: 'other-key', language: 'python', code: 'print(1)', files: [] })));
  assert.notEqual(hashJobRequest(base), hashJobRequest(validateJob({ idempotencyKey: key, language: 'python', code: 'print(2)', files: [] })));
});
