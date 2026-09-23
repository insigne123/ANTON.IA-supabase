import assert from 'node:assert/strict';
import test from 'node:test';
import { detectAutoReply, detectAutoReplyHeaders, matchesAutoReplyBody } from './reply-autoresponse';

test('auto-submitted header proves an automatic message', () => {
  assert.equal(detectAutoReplyHeaders([{ name: 'Auto-Submitted', value: 'auto-replied' }]), 'auto-submitted:auto-replied');
  assert.equal(detectAutoReplyHeaders({ 'auto-submitted': 'auto-generated' }), 'auto-submitted:auto-generated');
  assert.equal(detectAutoReplyHeaders([{ name: 'Auto-Submitted', value: 'no' }]), null);
  assert.equal(detectAutoReplyHeaders([]), null);
});

test('out-of-office and precedence headers are honored', () => {
  assert.equal(detectAutoReplyHeaders([{ name: 'X-Auto-Response-Suppress', value: 'OOF, AutoReply' }]), 'x-auto-response-suppress');
  assert.equal(detectAutoReplyHeaders([{ name: 'Precedence', value: 'bulk' }]), 'precedence:bulk');
  assert.equal(detectAutoReplyHeaders([{ name: 'X-Autoreply', value: 'yes' }]), 'x-autoreply');
  assert.equal(detectAutoReplyHeaders([{ name: 'Subject', value: 'Out of office' }]), null, 'subject alone is not a header proof');
});

test('real out-of-office bodies match in both languages', () => {
  assert.equal(matchesAutoReplyBody('I am currently out of the office. I will be back on Monday, January 5th. For urgent matters, please contact ana@example.com.'), true);
  assert.equal(matchesAutoReplyBody('Estoy fuera de la oficina con acceso limitado al correo. Regreso el 12 de enero. Para asuntos urgentes contacta a...'), true);
  assert.equal(matchesAutoReplyBody('Respuesta automática: estoy de vacaciones hasta el 20 de febrero.'), true);
  assert.equal(matchesAutoReplyBody('This is an automated response. Your message has been received and I will get back to you.'), true);
});

test('short human replies never match', () => {
  for (const human of [
    'Me interesa, hablemos el martes.',
    'No, gracias.',
    'Envíame más información por favor.',
    'Agendemos una reunión la próxima semana.',
    'Sí',
    '',
  ]) {
    assert.equal(matchesAutoReplyBody(human), false, JSON.stringify(human));
  }
});

test('sender address alone never decides', () => {
  assert.deepEqual(detectAutoReply({ text: 'Me interesa, hablemos.' }), { matched: false, reason: null, source: null });
  assert.deepEqual(detectAutoReply({ subject: 'Re: propuesta', text: 'Gracias, lo reviso y te comento.' }),
    { matched: false, reason: null, source: null });
});

test('headers win over ambiguous bodies', () => {
  const result = detectAutoReply({ headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }], text: 'Gracias.' });
  assert.equal(result.matched, true);
  assert.equal(result.source, 'headers');
});
