import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupliaApprovedActionPayload,
  getSupliaStrongConfirmationPhrase,
  requiresSupliaStrongConfirmation,
  validateSupliaStrongConfirmation,
} from './approval-guards';

test('strong approvals require APROBAR by default', () => {
  const missing = validateSupliaStrongConfirmation({
    approvalKind: 'strong',
    toolName: 'campaign.launch',
    payload: { campaignId: 'campaign-1' },
    confirmationText: '',
  });

  assert.equal(requiresSupliaStrongConfirmation('strong'), true);
  assert.equal(missing.valid, false);
  assert.equal(missing.requiredText, 'APROBAR');

  const confirmed = validateSupliaStrongConfirmation({
    approvalKind: 'strong',
    toolName: 'campaign.launch',
    payload: { campaignId: 'campaign-1' },
    confirmationText: ' aprobar ',
  });
  assert.equal(confirmed.valid, true);
});

test('real bulk send requires ENVIAR confirmation', () => {
  assert.equal(getSupliaStrongConfirmationPhrase('email.bulk_send', { dryRun: false }), 'ENVIAR');
  assert.equal(getSupliaStrongConfirmationPhrase('email.bulk_send', { dryRun: true }), 'APROBAR');

  const wrong = validateSupliaStrongConfirmation({
    approvalKind: 'strong',
    toolName: 'email.bulk_send',
    payload: { dryRun: false },
    confirmationText: 'APROBAR',
  });
  assert.equal(wrong.valid, false);
  assert.equal(wrong.requiredText, 'ENVIAR');

  const confirmed = validateSupliaStrongConfirmation({
    approvalKind: 'strong',
    toolName: 'email.bulk_send',
    payload: { dryRun: false },
    confirmationText: 'enviar',
  });
  assert.equal(confirmed.valid, true);
});

test('simple approvals do not require strong confirmation text', () => {
  const result = validateSupliaStrongConfirmation({
    approvalKind: 'simple',
    toolName: 'lead.enrich_batch',
    payload: { leads: [] },
    confirmationText: '',
  });

  assert.equal(result.valid, true);
  assert.equal(result.requiredText, null);
});

test('approved action payload injects ENVIAR only for confirmed real bulk send', () => {
  assert.deepEqual(
    buildSupliaApprovedActionPayload({
      toolName: 'email.bulk_send',
      payload: { dryRun: false, messages: [{ to: 'a@example.com' }] },
      requiredText: 'ENVIAR',
    }),
    { dryRun: false, messages: [{ to: 'a@example.com' }], strongConfirmationText: 'ENVIAR' },
  );

  assert.deepEqual(
    buildSupliaApprovedActionPayload({
      toolName: 'campaign.launch',
      payload: { campaignId: 'campaign-1' },
      requiredText: 'APROBAR',
    }),
    { campaignId: 'campaign-1' },
  );
});
