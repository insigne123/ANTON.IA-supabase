import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coworkCodeProposalSchema } from './code-proposal';

const base = { language: 'python' as const, code: 'print(1)', inputFiles: ['in.csv'] };

test('accepts a bounded code proposal', () => {
  const parsed = coworkCodeProposalSchema.parse(base);
  assert.equal(parsed.language, 'python');
  assert.deepEqual(parsed.inputFiles, ['in.csv']);
});

test('defaults to no input files', () => {
  const parsed = coworkCodeProposalSchema.parse({ language: 'node', code: 'x' });
  assert.deepEqual(parsed.inputFiles, []);
});

test('rejects oversized code, traversal and archives', () => {
  assert.throws(() => coworkCodeProposalSchema.parse({ ...base, code: 'x'.repeat(12289) }));
  assert.throws(() => coworkCodeProposalSchema.parse({ ...base, inputFiles: ['../evil.py'] }), /inválido/i);
  assert.throws(() => coworkCodeProposalSchema.parse({ ...base, inputFiles: ['a.zip'] }), /Extensión/);
  assert.throws(() => coworkCodeProposalSchema.parse({ ...base, inputFiles: ['a.csv', 'A.CSV'] }), /duplicados/i);
  assert.throws(() => coworkCodeProposalSchema.parse({ ...base, language: 'ruby' }));
});

test('rejects too many files', () => {
  assert.throws(() => coworkCodeProposalSchema.parse({
    ...base, inputFiles: Array.from({ length: 9 }, (_, index) => `a${index}.csv`),
  }));
});
