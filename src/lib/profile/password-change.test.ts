import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordChangeError, validatePasswordChange } from './password-change';

test('password validation rejects short or mismatched passwords without trimming secrets', () => {
  assert.match(validatePasswordChange('short', 'short')!, /8 caracteres/);
  assert.match(validatePasswordChange('long-password', 'different-password')!, /no coinciden/);
  assert.equal(validatePasswordChange(' long-password ', ' long-password '), null);
  assert.match(validatePasswordChange(' long-password ', 'long-password')!, /no coinciden/);
});

test('password errors provide actionable feedback without exposing server payloads', () => {
  assert.match(passwordChangeError('weak_password'), /segura/);
  assert.match(passwordChangeError('same_password'), /diferente/);
  assert.match(passwordChangeError('reauthentication_not_valid'), /codigo/);
  assert.match(passwordChangeError('session_not_found'), /sesion/);
  assert.doesNotMatch(passwordChangeError('secret-server-error'), /secret-server-error/);
});
