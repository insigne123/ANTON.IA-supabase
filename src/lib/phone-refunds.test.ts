import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePhoneList, phoneDigits, phoneRefundLabel, phoneRefundReportText, phoneRefundSummary, samePhone, showPhone, type PhoneRefundClaim } from './phone-refunds';

test('a phone is its digits, however it was written; what cannot be one is not', () => {
  assert.equal(phoneDigits('+56 9 8765 4321'), '56987654321');
  assert.equal(phoneDigits('0056 (2) 2345-6789'), '56223456789');
  assert.equal(phoneDigits(987654321), '987654321');
  for (const value of ['', null, 'abc', '12345', '1234567890123456', 'Not Found']) assert.equal(phoneDigits(value), null);
  assert.equal(showPhone('56987654321'), '+56987654321');
});

test('the same phone with and without the country prefix is one; two different numbers are not', () => {
  assert.ok(samePhone('56987654321', '987654321'));
  assert.ok(samePhone('987654321', '56987654321'));
  assert.ok(samePhone('56987654321', '56987654321'));
  assert.equal(samePhone('56987654321', '56987654322'), false);
  assert.equal(samePhone('4321', '56987654321'), false, 'a short ending is not a match');
});

test('a pasted list: one per line, or with commas and semicolons, without repeats; what is not a phone is said apart', () => {
  assert.deepEqual(parsePhoneList('+56 9 8765 4321\n9 8765 4321, +56 2 2345 6789; hola\n\n123'),
    { phones: ['56987654321', '56223456789'], invalid: ['hola', '123'] });
  assert.deepEqual(parsePhoneList(''), { phones: [], invalid: [] });
});

test('what the card answers after a sending, and its one line over the list', () => {
  assert.equal(phoneRefundReportText({ added: 2, repeated: [], unknown: [], invalid: [] }), 'Recibimos 2 teléfonos: los probamos y te avisamos aquí.');
  assert.equal(phoneRefundReportText({ added: 1, repeated: ['56911112222'], unknown: ['56933334444', '56955556666'], invalid: ['hola'] }),
    'Recibimos 1 teléfono: lo probamos y te avisamos aquí. Ya estaba en la lista: +56911112222. No los encontramos entre los teléfonos que te entregó ANTON.IA: +56933334444, +56955556666. No parece un teléfono: hola.');
  assert.equal(phoneRefundReportText({ added: 0, repeated: [], unknown: [], invalid: [] }), 'Escribe al menos un teléfono.');
  const claim = (status: PhoneRefundClaim['status'], credits = 5): PhoneRefundClaim => ({ id: status, phone: '56987654321', contactName: null, credits, status, reportedAt: '2026-12-02T12:00:00Z', reviewedAt: null, reviewNote: null });
  assert.equal(phoneRefundSummary([claim('reported'), claim('confirmed'), claim('confirmed'), claim('rejected')]), '1 en revisión · 2 devueltos (10 créditos)');
  assert.equal(phoneRefundSummary([claim('reported'), claim('reported')]), '2 en revisión');
  assert.equal(phoneRefundSummary([claim('confirmed', 1)]), '0 en revisión · 1 devuelto (1 crédito)');
  assert.deepEqual(['reported', 'confirmed', 'rejected'].map(status => phoneRefundLabel(status as PhoneRefundClaim['status'])), ['En revisión', 'Devuelto', 'Sin devolución']);
});
