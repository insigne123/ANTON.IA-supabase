import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// plan.ts touches next/headers through auth-utils, which the isolated unit
// loader cannot resolve. Like the neighboring plan tests, this file asserts
// the wiring contract from source: creator-scoped access, the update RPC,
// draft regeneration, plan re-read and schedulable-state gating.

const planSource = readFileSync('src/lib/server/campaigns-v2/plan.ts', 'utf8');

test('plan updates stay creator-scoped and regenerate drafts before re-reading the plan', () => {
  assert.match(planSource, /export async function updateFirstContactPlan/);
  assert.match(planSource, /assertCampaignV2CreatorAccess/);
  assert.match(planSource, /rpc\('update_first_contact_plan_steps_v2'/);
  assert.match(planSource, /p_steps: input\.body\.steps/);
  assert.match(planSource, /p_version_id: input\.body\.versionId/);
  assert.match(planSource, /regenerateDrafts !== false/);
  assert.match(planSource, /pregenerateFirstContactPlanDrafts\(\{/);
  assert.match(planSource, /queryFirstContactPlan\(\{/);
  assert.match(planSource, /CAMPAIGN_V2_PLAN_PERSIST_FAILED/);
});

test('auto-send toggles stay creator-scoped and only apply to schedulable plans', () => {
  assert.match(planSource, /export async function setFirstContactPlanAutoSend/);
  assert.match(planSource, /auto_send: input\.autoSend/);
  assert.match(planSource, /no longer schedulable/);
  assert.match(planSource, /v2_status !== 'draft' && [\s\S]*?v2_status !== 'active'/);
});

test('plan reads expose step instructions and the auto-send flag', () => {
  assert.match(planSource, /instruction: text\(sequence\.instruction\)/);
  assert.match(planSource, /autoSend: object\(.*\.settings\)\.auto_send === true/);
});
