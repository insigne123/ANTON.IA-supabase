import assert from 'node:assert/strict';
import test from 'node:test';
import { aiErrorForPerson, aiFailureMessage, aiFailureStatus } from './ai-failure-message';

test('an AI failure never shows the provider error, and an account without credits says retrying does not help', () => {
  const quota = new Error('OPENAI_HTTP_429:{"error":{"message":"You have no credits remaining.","type":"insufficient_quota"}}');
  assert.match(aiFailureMessage(quota, 'No se pudo generar el guion con IA.'), /reintentar ahora no lo resuelve/);
  assert.equal(aiFailureStatus(quota), 503);
  const other = new Error('OPENAI_HTTP_500:{"error":"boom"}');
  assert.equal(aiFailureMessage(other, 'No se pudo generar el guion con IA.'), 'No se pudo generar el guion con IA.');
  assert.equal(aiFailureStatus(other), 500);
  assert.doesNotMatch(aiFailureMessage(quota, ''), /OPENAI|insufficient|HTTP/);
});

test('an AI route keeps the app\'s own words and hides what failed inside the AI call', () => {
  const fallback = 'No se pudo generar el correo con IA. Reintenta en un momento.';
  assert.equal(aiErrorForPerson(new Error('OPENAI_HTTP_500:{"error":"boom"}'), fallback), fallback);
  assert.equal(aiErrorForPerson(new Error('Missing AI provider credentials. Set OPENAI_API_KEY to use OpenAI.'), fallback), fallback);
  assert.equal(aiErrorForPerson(Object.assign(new Error('[{"code":"invalid_type"}]'), { name: 'ZodError' }), fallback), fallback);
  assert.equal(aiErrorForPerson(Object.assign(new Error('Structured generation timed out.'), { name: 'TimeoutError' }), fallback), fallback);
  assert.equal(aiErrorForPerson(new Error('El lead debe tener al menos un nombre.'), fallback), 'El lead debe tener al menos un nombre.');
  assert.equal(aiErrorForPerson(null, fallback), fallback);
  assert.match(aiErrorForPerson(new Error('OPENAI_HTTP_429:{"error":{"type":"insufficient_quota"}}'), fallback), /reintentar ahora no lo resuelve/);
});
