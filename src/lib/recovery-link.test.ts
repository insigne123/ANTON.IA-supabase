import assert from 'node:assert/strict';
import test from 'node:test';
import { RESET_PASSWORD_PATH, recoveryPagePath, recoveryTokenHash } from './recovery-link';

const params = (query: string) => new URLSearchParams(query);

test('only a recovery link with a token-shaped hash gives a token', () => {
  assert.equal(recoveryTokenHash(params('token_hash=abc_DEF-123&type=recovery')), 'abc_DEF-123');
  assert.equal(recoveryTokenHash(params('token_hash=abc')), null, 'no type');
  assert.equal(recoveryTokenHash(params('token_hash=abc&type=signup')), null, 'another kind of link');
  assert.equal(recoveryTokenHash(params('type=recovery')), null, 'no token');
  assert.equal(recoveryTokenHash(params('token_hash=a%20b&type=recovery')), null, 'not a token');
  assert.equal(recoveryTokenHash(params(`token_hash=${'a'.repeat(257)}&type=recovery`)), null, 'too long');
});

test('the page of a recovery link keeps the token in its address, still unspent', () => {
  assert.equal(RESET_PASSWORD_PATH, '/restablecer-clave');
  assert.equal(recoveryPagePath('abc_DEF-123'), '/restablecer-clave?token_hash=abc_DEF-123&type=recovery');
  assert.equal(recoveryTokenHash(new URL(recoveryPagePath('abc_DEF-123'), 'https://app.test').searchParams), 'abc_DEF-123');
});
