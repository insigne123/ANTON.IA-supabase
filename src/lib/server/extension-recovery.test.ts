import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreProfileEdits } from '../../../chrome-extension/ui/profile-cache';
import { blockLines } from '../../../chrome-extension/ui/report-blocks';
import { reportStatusLabel } from '../../../chrome-extension/ui/research-state';
test('clean or legacy cache never replaces server; dirty conflict is explicit', () => {
  const server = { updated_at: 'new', email: 'current@example.test' };
  assert.equal(restoreProfileEdits(server, { profile: { email: 'old' }, dirty: false }).profile, server);
  assert.equal(restoreProfileEdits(server, { email: 'legacy' }).profile, server);
  assert.equal(restoreProfileEdits(server, { profile: { email: 'draft' }, dirty: true, baseUpdatedAt: 'old' }).conflict, true);
  assert.equal(restoreProfileEdits(server, { profile: { email: 'draft' }, dirty: true, baseUpdatedAt: 'new' }).restored, true);
});
test('structured payloads retain nested values including false and zero', () => {
  const result = blockLines({ events: [{ date: '2026-09-13', text: 'Expansión' }], rows: [{ label: 'Horas', value: 0 }], approved: false }).join('\n');
  assert.match(result, /Expansión/); assert.match(result, /2026-09-13/); assert.match(result, /Valor: 0/); assert.match(result, /No/);
});
test('synthesis failure and absent synthesis are distinct states', () => {
  assert.match(reportStatusLabel({ reportSynthesisV2: { status: 'failed_permanent' } }), /No se pudo/);
  assert.match(reportStatusLabel({ researchSnapshotId: 'snapshot' }), /No hay/);
});
