import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalFailureText } from './approval-failure';
import { EDITED_EMAIL_BODY_WORDS, EMAIL_BODY_WORDS, emailLengthNote, emailWordCount } from './email-length';

test('the editor counts words as the preflight does and says why a length matters', () => {
  assert.equal(emailWordCount('Hola Ana,\n\n¿Conversamos 15 minutos el jueves?'), 7);
  assert.deepEqual(emailLengthNote(120), { tone: 'quiet', text: '120 palabras' });
  assert.equal(emailLengthNote(221).tone, 'notice');
  assert.match(emailLengthNote(221).text, /^221 palabras\. Puedes enviarlo; los correos en frío de hasta 180/);
  assert.equal(emailLengthNote(20).tone, 'notice');
  assert.equal(emailLengthNote(EDITED_EMAIL_BODY_WORDS.max + 1).tone, 'stop');
  assert.equal(emailLengthNote(5).tone, 'stop');
  assert.equal(emailLengthNote(0).tone, 'quiet', 'an empty editor is not an error yet');
  assert.deepEqual([EMAIL_BODY_WORDS.min, EMAIL_BODY_WORDS.max], [35, 180], 'the same limits as the draft contract (draft-context-v2)');
});

test('a review that cannot be confirmed says why', () => {
  assert.equal(approvalFailureText({ error: 'NATIVE_DRAFT_PREFLIGHT_FAILED', message: 'El correo tiene 421 palabras: para enviarlo, debe tener entre 10 y 400.' }),
    'El correo tiene 421 palabras: para enviarlo, debe tener entre 10 y 400.');
  assert.match(approvalFailureText({ error: 'NATIVE_DRAFT_VERSION_CONFLICT' }), /otra pestaña/);
  assert.match(approvalFailureText({ error: 'NATIVE_DRAFT_PRIVACY_SUPPRESSED' }), /pidió no recibir/);
  assert.equal(approvalFailureText(null), 'Revisa el correo e inténtalo nuevamente.');
});
