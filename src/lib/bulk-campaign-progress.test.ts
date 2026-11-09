import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignProgress, recipientProgress } from './bulk-campaign-progress';
import type { CampaignAttempt } from './bulk-campaign-attempts';
import type { CampaignDelivery, CampaignRecipient } from './bulk-campaigns';

const APPROVED = '2026-11-01T12:00:00Z';
const NOW = Date.parse('2026-11-09T12:00:00Z');
const person = (email: string, ...drafts: string[]) => ({
  email, name: email.split('@')[0],
  messages: drafts.map((draftId, index) => ({ draftId, versionId: `${draftId}-v`, subject: 'Hola', body: 'Texto', delayDays: index ? 3 : 0 })),
}) as unknown as CampaignRecipient;
const sent = (draftId: string, at = '2026-11-08T12:00:00Z'): CampaignDelivery => ({ draft_id: draftId, status: 'sent', completed_at: at, error_message: null });
const read = (recipient: CampaignRecipient, deliveries: CampaignDelivery[] = [], attempts: CampaignAttempt[] = [], extra: { replied?: boolean; automation?: boolean } = {}) =>
  recipientProgress({ recipient, deliveries, attempts, approvedAt: APPROVED, replied: extra.replied ?? false, automation: extra.automation ?? true, now: NOW });

test('each person says where they stand in one badge and one line, with the date of what comes next', () => {
  const ana = person('ana@cliente.cl', 'a1', 'a2');
  const waiting = read(ana, [sent('a1')]);
  assert.equal(waiting.tone, 'scheduled');
  assert.equal(waiting.detail, 'Seguimiento 1');
  assert.equal(waiting.at, '2026-11-11T12:00:00.000Z', 'three days after the confirmed first e-mail');
  assert.deepEqual([waiting.sent, waiting.total], [1, 2]);

  assert.equal(read(ana, [sent('a1'), sent('a2')]).tone, 'done');
  assert.equal(read(ana, [sent('a1'), sent('a2')]).label, 'Secuencia completa');

  const ready = read(ana);
  assert.equal(ready.tone, 'ready');
  assert.equal(ready.detail, 'Correo inicial: sale en el próximo envío automático.');
  assert.equal(read(ana, [], [], { automation: false }).detail, 'Correo inicial: sale con «Enviar correos disponibles».');
  assert.equal(recipientProgress({ recipient: ana, deliveries: [], attempts: [], approvedAt: APPROVED, replied: false, automation: true, paused: true, now: NOW }).detail,
    'Correo inicial: sale al reanudar la campaña.', 'a paused campaign sends nothing');
});

test('an answer stops the follow-ups and is what the person shows', () => {
  const ana = person('ana@cliente.cl', 'a1', 'a2');
  const replied = read(ana, [sent('a1')], [], { replied: true });
  assert.deepEqual([replied.tone, replied.label, replied.detail], ['replied', 'Respondió', 'Los seguimientos se detienen.']);
  assert.equal(read(ana, [sent('a1'), sent('a2')], [], { replied: true }).detail, null, 'nothing was left to stop');
});

test('a problem says which e-mail and why, in the words of the attempt, never the provider\'s', () => {
  const ana = person('ana@cliente.cl', 'a1', 'a2');
  const failed = read(ana, [{ draft_id: 'a1', status: 'failed', completed_at: APPROVED, error_message: 'Mailbox full (552 5.2.2)' }],
    [{ draft_id: 'a1', state: 'attention', code: 'failed', message: 'No se pudo enviar el correo. Revisa el contacto y la cuenta de envío.', retry_at: null, updated_at: null }]);
  assert.deepEqual([failed.tone, failed.label], ['failed', 'No salió']);
  assert.equal(failed.detail, 'Correo inicial: no se pudo enviar el correo. Revisa el contacto y la cuenta de envío.');
  assert.equal(failed.retryDraftId, null, 'a failed send is never retried from here');
  // Without an attempt, the plain line of the delivery state.
  assert.equal(read(ana, [{ draft_id: 'a1', status: 'failed', completed_at: APPROVED, error_message: 'raw' }]).detail,
    'Correo inicial: no se pudo enviar. Revisa el contacto y la cuenta de envío.');

  const quota = read(ana, [], [{ draft_id: 'a1', state: 'retry_wait', code: 'daily_quota_exceeded', message: 'Se alcanzó el límite diario. Se volverá a comprobar la cuota.', retry_at: '2026-11-10T09:00:00Z', updated_at: null }]);
  assert.deepEqual([quota.tone, quota.label, quota.at, quota.retryDraftId], ['retrying', 'En espera', '2026-11-10T09:00:00Z', null], 'the daily limit ends on its own');
  const reconnect = read(ana, [], [{ draft_id: 'a1', state: 'retry_wait', code: 'provider_connection_unavailable', message: 'Reconecta tu cuenta de correo. Volveremos a comprobar la conexión.', retry_at: '2026-11-10T09:00:00Z', updated_at: null }]);
  assert.equal(reconnect.retryDraftId, 'a1', 'after reconnecting the mailbox, «Volver a comprobar» does not wait for the hour');
  assert.equal(quota.detail, 'Correo inicial: se alcanzó el límite diario. Se volverá a comprobar la cuota.');

  const blocked = read(ana, [], [{ draft_id: 'a1', state: 'attention', code: 'BULK_CAMPAIGN_CONTACT_BLOCKED', message: 'El contacto respondió, se dio de baja o está marcado como no contactar.', retry_at: null, updated_at: null }]);
  assert.deepEqual([blocked.tone, blocked.label, blocked.retryDraftId], ['attention', 'Requiere atención', null], 'a block is lifted only by a review');
});

test('an Outlook send waiting for its confirmation is not a problem', () => {
  const ana = person('ana@cliente.cl', 'a1', 'a2');
  const unknown = read(ana, [{ draft_id: 'a1', status: 'unknown', completed_at: APPROVED, error_message: 'Provider accepted the message without a usable message identifier.' }],
    [{ draft_id: 'a1', state: 'attention', code: 'invalid_provider_response', message: 'El envío está pendiente de confirmación. No se repetirá automáticamente.', retry_at: null, updated_at: null }]);
  assert.deepEqual([unknown.tone, unknown.label], ['confirming', 'Por confirmar']);
  assert.equal(unknown.detail, 'Correo inicial: falta confirmar si salió. Lo buscamos en tus enviados y no se repite.');
});

test('the campaign adds its people up: e-mails, people reached, answers, attention and the next date', () => {
  const recipients = [person('ana@cliente.cl', 'a1', 'a2'), person('Bruno@Cliente.cl', 'b1', 'b2'), person('carla@cliente.cl', 'c1', 'c2'), person('dani@cliente.cl', 'd1', 'd2')];
  const deliveries = [sent('a1', '2026-11-08T12:00:00Z'), sent('b1', '2026-11-07T12:00:00Z'), { draft_id: 'c1', status: 'failed', completed_at: APPROVED, error_message: null }];
  const progress = campaignProgress({ campaign: { recipients, approved_at: APPROVED }, deliveries, attempts: [], replied: ['bruno@cliente.cl'], automation: true, now: NOW });
  assert.equal(progress.recipients, 4);
  assert.equal(progress.reached, 2);
  assert.deepEqual([progress.sentMessages, progress.totalMessages], [2, 8]);
  assert.equal(progress.replied, 1);
  assert.equal(progress.attention, 1, 'the failed send');
  assert.equal(progress.nextAt, '2026-11-11T12:00:00.000Z', 'Ana\'s follow-up; Bruno answered');
  assert.equal(progress.finished, false);
  assert.equal(campaignProgress({ campaign: { recipients, approved_at: APPROVED }, deliveries, attempts: [], replied: null, automation: true, now: NOW }).replied, null,
    'answers that could not be read are not «0»');
  const done = campaignProgress({ campaign: { recipients: recipients.slice(0, 2), approved_at: APPROVED }, deliveries: [sent('a1'), sent('a2'), sent('b1')], attempts: [], replied: ['bruno@cliente.cl'], automation: true, now: NOW });
  assert.equal(done.finished, true);
});
