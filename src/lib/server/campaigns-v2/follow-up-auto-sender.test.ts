import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAutoSendBusinessDay,
  runCampaignV2AutoSend,
  type AutoSendClaimedStep,
  type AutoSendDependencies,
} from './follow-up-auto-sender';

function step(overrides: Partial<AutoSendClaimedStep> = {}): AutoSendClaimedStep {
  return {
    step_id: 'step-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    campaign_id: 'camp-1',
    enrollment_id: 'enr-1',
    step_index: 1,
    recipient_email: 'renzo@example.com',
    native_draft_id: 'draft-1',
    native_version_id: 'version-1',
    due_at: new Date().toISOString(),
    ...overrides,
  };
}

test('auto-send pauses on weekends without claiming steps', async () => {
  let claimed = 0;
  const result = await runCampaignV2AutoSend({
    now: () => new Date('2026-09-12T15:00:00.000Z'), // Saturday
    claimSteps: async () => { claimed += 1; return [step()]; },
    sendStep: async () => 'sent',
  });
  assert.equal(isAutoSendBusinessDay(new Date('2026-09-12T15:00:00.000Z')), false);
  assert.equal(claimed, 0);
  assert.equal(result.checked, 0);
  assert.equal(result.businessDay, false);
});

test('auto-send aggregates per-step outcomes on business days', async () => {
  const result = await runCampaignV2AutoSend({
    now: () => new Date('2026-09-10T15:00:00.000Z'), // Thursday
    claimSteps: async () => [step({ step_id: 'a' }), step({ step_id: 'b' }), step({ step_id: 'c' })],
    sendStep: async (_client, candidate) => {
      if (candidate.step_id === 'a') return 'sent';
      if (candidate.step_id === 'b') return 'deferred';
      return 'blocked';
    },
  });
  assert.equal(result.businessDay, true);
  assert.deepEqual(
    { checked: result.checked, sent: result.sent, deferred: result.deferred, blocked: result.blocked },
    { checked: 3, sent: 1, deferred: 1, blocked: 1 },
  );
});

test('a conflicting concurrent send is skipped, never duplicated', async () => {
  const result = await runCampaignV2AutoSend({
    now: () => new Date('2026-09-10T15:00:00.000Z'),
    claimSteps: async () => [step()],
    sendStep: async () => 'skipped',
  });
  assert.equal(result.skipped, 1);
  assert.equal(result.sent, 0);
});
