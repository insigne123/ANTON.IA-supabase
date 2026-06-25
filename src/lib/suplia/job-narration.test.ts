import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSupliaApprovalRequiredMessage, buildSupliaJobIntroMessage, buildSupliaStepStartedMessage } from './job-narration';

test('job intro explains plan approval before external credits', () => {
  const message = buildSupliaJobIntroMessage({ job_type: 'prospecting_campaign' });
  assert.ok(message.includes('No voy a buscar leads'));
  assert.ok(message.includes('aprobacion del plan'));
  assert.ok(message.includes('Apollo/PDL'));
});

test('plan approval message is explicit and safe', () => {
  const message = buildSupliaApprovalRequiredMessage({
    actionType: 'workflow.approve_plan',
    description: 'Aprueba el plan para seguir con ICP.',
  });
  assert.ok(message.includes('Plan listo'));
  assert.ok(message.includes('Aprueba el plan'));
});

test('step narration uses user-facing copy', () => {
  assert.ok(buildSupliaStepStartedMessage({ step_key: 'icp_strategy' }).includes('ICP'));
  assert.ok(buildSupliaStepStartedMessage({ step_key: 'prospector_approval' }).includes('aprobable'));
});
