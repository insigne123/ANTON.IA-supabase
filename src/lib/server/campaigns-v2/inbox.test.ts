import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { campaignV2ComposeUrl, campaignV2NextAction } from './state';

const inboxSource = readFileSync('src/lib/server/campaigns-v2/inbox.ts', 'utf8');
const inboxRouteSource = readFileSync('src/app/api/campaigns/v2/inbox/route.ts', 'utf8');

test('Campaign V2 inbox maps recipient state to the frontend action contract', () => {
  assert.equal(campaignV2NextAction({ state: 'ready_to_prepare' }), 'prepare');
  assert.equal(campaignV2NextAction({ state: 'review_required' }), 'review');
  assert.equal(campaignV2NextAction({ state: 'approved' }), 'send');
  assert.equal(campaignV2NextAction({ state: 'pending_initial_send', nativeDraftReady: true }), 'send');
  assert.equal(campaignV2NextAction({ state: 'pending_initial_send', nativeDraftReady: false }), 'review');
  assert.equal(campaignV2NextAction({ state: 'sending' }), 'resolve');
  assert.equal(campaignV2NextAction({ state: 'failed' }), 'resolve');
});

test('Campaign V2 compose links bind both native draft and recipient step', () => {
  assert.equal(
    campaignV2ComposeUrl('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
    '/contact/compose?draftId=10000000-0000-4000-8000-000000000001&campaignStepId=20000000-0000-4000-8000-000000000001',
  );
});

test('Campaign V2 inbox globally pages eligible steps without a campaign pre-cap', () => {
  assert.match(inboxSource, /userId: string/);
  assert.match(inboxSource, /organizationIds: string\[\]/);
  assert.match(inboxRouteSource, /organizationIds: auth\.organizationIds/);
  assert.match(inboxSource, /enabledCampaignV2OrganizationIds\(input\.organizationIds, client\)/);
  assert.ok((inboxSource.match(/\.in\('organization_id', organizationIds\)/g) || []).length >= 4);
  assert.ok((inboxSource.match(/\.eq\('user_id', input\.userId\)/g) || []).length >= 4);
  assert.match(inboxSource, /\.from\('campaign_recipient_steps'\)[\s\S]+campaign:campaigns!inner/);
  assert.doesNotMatch(inboxSource, /\.from\('campaigns'\)/);
  assert.match(inboxSource, /\.in\('campaign\.v2_status', \['draft', 'active', 'blocked'\]\)/);
  assert.match(inboxSource, /\.or\('state\.neq\.not_due,due_at\.not\.is\.null'\)/);
  assert.match(inboxSource, /\.limit\(CAMPAIGN_V2_INBOX_PAGE_SIZE \+ 1\)/);
  assert.doesNotMatch(inboxSource, /MAX_INBOX_ITEMS|truncated|\.range\(/);
  assert.match(inboxRouteSource, /userId: auth\.user\.id/);
  assert.match(inboxSource, /'pending_initial_send',\s*'not_due'/);
  assert.match(inboxSource, /enrollmentId: row\.enrollment_id/);
});

test('Campaign V2 inbox uses a versioned stable keyset and returns a truthful next page', () => {
  assert.match(inboxSource, /version: z\.literal\(1\)/);
  assert.match(inboxSource, /orderAt: z\.string\(\)\.datetime/);
  assert.match(inboxSource, /\.order\('inbox_order_at', \{ ascending: true, nullsFirst: false \}\)/);
  assert.match(inboxSource, /\.order\('id', \{ ascending: true \}\)/);
  assert.match(inboxSource, /id\.gt\.\$\{cursor\.stepId\}/);
  assert.doesNotMatch(inboxSource, /cursor\.updatedAt|cursor\.dueAt/);
  assert.match(inboxSource, /const hasMore = stepRows\.length > CAMPAIGN_V2_INBOX_PAGE_SIZE/);
  assert.match(inboxSource, /const nextCursor = hasMore \? encodeInboxCursor\(steps\[steps\.length - 1\]\) : null/);
  assert.match(inboxSource, /scope: 'page' as const/);
  assert.match(inboxRouteSource, /CampaignV2InboxResponseSchema\.safeParse\(inbox\)/);
  assert.doesNotMatch(inboxRouteSource, /ZodError/);
});
