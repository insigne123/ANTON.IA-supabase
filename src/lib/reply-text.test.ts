import assert from 'node:assert/strict';
import test from 'node:test';
import { isExplicitOptOut, newReplyText } from './reply-text';
import { classifyReply } from './reply-classifier';

test('opt-out matching reads only new reply, including common Spanish and English wording', () => {
  for (const message of ['Por favor denme de baja', 'No me escriban más', 'Remove me from your list', 'Do not contact me again', 'No quiero que me manden más emails', 'No más correos, por favor']) assert.equal(isExplicitOptOut(message), true, message);
  assert.equal(isExplicitOptOut('No deseo darme de baja'), false);
  assert.equal(isExplicitOptOut('Me interesa conocer más'), false);
  assert.equal(isExplicitOptOut('Gracias.\n\nEl 21/09 escribiste: No me contacten\n\nSi prefieres no recibir más correos, responde a este mensaje.'), false);
});

test('quoted reply is removed before classification and preview', () => {
  assert.equal(newReplyText('Gracias, me interesa.\n\n--\nSi no deseas recibir más, date de baja aquí'), 'Gracias, me interesa.');
  assert.equal(isExplicitOptOut('<p>Gracias</p><blockquote>Por favor, no me contacten</blockquote>'), false);
});

test('explicit opt-out overrides model classification deterministically', async () => {
  assert.equal((await classifyReply('Por favor elimínenme de su lista')).intent, 'unsubscribe');
});
