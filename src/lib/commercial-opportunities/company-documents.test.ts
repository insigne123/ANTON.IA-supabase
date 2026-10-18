import assert from 'node:assert/strict';
import test from 'node:test';
import { chileToday, companyDocumentAlerts, companyDocumentInputSchema, companyDocumentLabel, companyDocumentStatus, companyDocumentsForModel, suggestedExpiry } from './company-documents';

const today = '2026-10-18';

test('a document is current, about to lapse within 15 days, lapsed, or does not lapse', () => {
  assert.deepEqual(companyDocumentStatus('2026-12-01', today), { status: 'vigente', daysLeft: 44 });
  assert.deepEqual(companyDocumentStatus('2026-11-02', today), { status: 'por_vencer', daysLeft: 15 });
  assert.deepEqual(companyDocumentStatus('2026-10-18', today), { status: 'por_vencer', daysLeft: 0 }, 'valid all of its last day');
  assert.deepEqual(companyDocumentStatus('2026-10-17', today), { status: 'vencido', daysLeft: -1 });
  assert.deepEqual(companyDocumentStatus(null, today), { status: 'sin_fecha', daysLeft: null });
});

test('the status reads in words, in Chile', () => {
  assert.equal(companyDocumentLabel('2026-12-01', today), 'Vigente hasta el 1 de diciembre de 2026');
  assert.equal(companyDocumentLabel('2026-10-23', today), 'Vence en 5 días');
  assert.equal(companyDocumentLabel('2026-10-19', today), 'Vence mañana');
  assert.equal(companyDocumentLabel('2026-10-18', today), 'Vence hoy');
  assert.equal(companyDocumentLabel('2026-10-03', today), 'Venció el 3 de octubre de 2026');
  assert.equal(companyDocumentLabel(null, today), 'Sin vencimiento');
  assert.equal(chileToday(new Date('2026-10-19T02:30:00Z')), '2026-10-18', 'at 23:30 in Santiago it is still the 18th');
});

test('an F30 or a certificate of good standing suggests its expiry from the issue date; an ISO certificate does not', () => {
  assert.equal(suggestedExpiry('f30', '2026-10-01'), '2026-10-31');
  assert.equal(suggestedExpiry('vigencia', '2026-10-01'), '2026-11-30');
  assert.equal(suggestedExpiry('iso', '2026-10-01'), null);
  assert.equal(suggestedExpiry('f30', 'ayer'), null);
});

test('the alerts are the lapsed and the soon to lapse, soonest first', () => {
  const alerts = companyDocumentAlerts([
    { id: 'a', label: 'Certificado F30', expiresAt: '2026-10-23' }, { id: 'b', label: 'ISO 9001', expiresAt: '2027-05-01' },
    { id: 'c', label: 'Certificado de vigencia', expiresAt: '2026-10-10' }, { id: 'd', label: 'Estados financieros 2025', expiresAt: null },
  ], today);
  assert.deepEqual(alerts.map(alert => [alert.id, alert.status, alert.text]), [
    ['c', 'vencido', 'Certificado de vigencia: venció el 10 de octubre de 2026'], ['a', 'por_vencer', 'Certificado F30: vence en 5 días']]);
});

test('the model reads each document with its status today', () => {
  assert.deepEqual(companyDocumentsForModel([{ kind: 'f30', label: 'F30 octubre', expiresAt: '2026-10-10' }, { kind: 'iso', label: 'ISO 9001', expiresAt: '2027-05-01' }], today), [
    { documento: 'F30 octubre', tipo: 'Certificado F30', estado: 'venció el 10 de octubre de 2026' },
    { documento: 'ISO 9001', tipo: 'Certificado ISO', estado: 'vigente hasta el 1 de mayo de 2027' }]);
});

test('the input takes a known kind, a name and a real date or none', () => {
  assert.deepEqual(companyDocumentInputSchema.parse({ kind: 'f30', label: ' F30 ', expiresAt: null }), { kind: 'f30', label: 'F30', expiresAt: null });
  assert.throws(() => companyDocumentInputSchema.parse({ kind: 'pasaporte', label: 'X', expiresAt: null }));
  assert.throws(() => companyDocumentInputSchema.parse({ kind: 'f30', label: 'F30', expiresAt: '2026-13-45' }));
});
