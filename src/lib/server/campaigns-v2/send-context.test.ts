import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CampaignV2DispatchRetrySchema } from '@/lib/campaigns-v2/contracts';

const source = readFileSync('src/lib/server/campaigns-v2/send-context.ts', 'utf8');

test('only accepts persisted retry metadata with retryable=true', () => {
  const retry = {
    retryable: true,
    phase: 'pre_provider',
    code: 'quota_reservation_unavailable',
    retryAt: '2026-08-26T00:00:00.000Z',
    retryAfterMs: 30_000,
  };
  assert.equal(CampaignV2DispatchRetrySchema.safeParse(retry).success, true);
  assert.equal(CampaignV2DispatchRetrySchema.safeParse({ ...retry, retryable: false }).success, false);
  assert.equal(CampaignV2DispatchRetrySchema.safeParse({ ...retry, phase: 'unknown' }).success, false);
  assert.match(source, /CampaignV2DispatchRetrySchema\.safeParse\(retry\)/);
});

test('send context binds dispatch identity to the creator-owned step draft and version', () => {
  assert.match(source, /\.eq\('organization_id', input\.organizationId\)/);
  assert.match(source, /\.eq\('user_id', input\.userId\)/);
  assert.match(source, /\.eq\('campaign_recipient_step_id', input\.stepId\)/);
  assert.match(source, /dispatch\.draft_id !== step\.native_draft_id/);
  assert.match(source, /dispatch\.version_id !== step\.native_version_id/);
  assert.match(source, /assertCampaignV2CreatorAccess/);
});
