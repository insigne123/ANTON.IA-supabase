import test from 'node:test';
import assert from 'node:assert/strict';

const emailProvider = await import('../src/lib/email-provider.ts');

test('normalizeConnectedEmailProvider maps gmail alias to google', () => {
  assert.equal(emailProvider.normalizeConnectedEmailProvider('gmail'), 'google');
  assert.equal(emailProvider.normalizeConnectedEmailProvider(' GOOGLE '), 'google');
});

test('normalizeConnectedEmailProvider keeps outlook and rejects unknown providers', () => {
  assert.equal(emailProvider.normalizeConnectedEmailProvider('outlook'), 'outlook');
  assert.equal(emailProvider.normalizeConnectedEmailProvider(''), null);
  assert.equal(emailProvider.normalizeConnectedEmailProvider('yahoo'), null);
});
