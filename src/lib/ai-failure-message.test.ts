import assert from 'node:assert/strict';
import test from 'node:test';
import { aiFailureMessage, aiFailureStatus } from './ai-failure-message';

test('an AI failure never shows the provider error, and an account without credits says retrying does not help', () => {
  const quota = new Error('OPENAI_HTTP_429:{"error":{"message":"You have no credits remaining.","type":"insufficient_quota"}}');
  assert.match(aiFailureMessage(quota, 'No se pudo generar el guion con IA.'), /reintentar ahora no lo resuelve/);
  assert.equal(aiFailureStatus(quota), 503);
  const other = new Error('OPENAI_HTTP_500:{"error":"boom"}');
  assert.equal(aiFailureMessage(other, 'No se pudo generar el guion con IA.'), 'No se pudo generar el guion con IA.');
  assert.equal(aiFailureStatus(other), 500);
  assert.doesNotMatch(aiFailureMessage(quota, ''), /OPENAI|insufficient|HTTP/);
});
