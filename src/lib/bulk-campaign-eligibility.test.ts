import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { campaignProgress, recipientEligibility } from './bulk-campaign-eligibility';
import { defaultAudience, type AudiencePerson, type BulkCampaign } from './bulk-campaigns';

const person = (overrides: Partial<AudiencePerson> = {}): AudiencePerson => ({
  email: 'ana@retail.cl', name: 'Ana', company: 'Retail Andino', title: 'Gerente de Personas', industry: 'Retail',
  country: 'Chile', size: '201-500', seniority: 'manager', leadRef: 'lead-1', lastSentAt: null,
  contacted: false, replied: false, blockedReason: null, reasons: [], enriched: true, ...overrides,
});

test('the check before each send: still a contact, not blocked, no follow-up after a reply, a first message still matches', () => {
  const criteria = defaultAudience;
  assert.deepEqual(recipientEligibility(person(), 0, criteria), { ok: true });
  assert.equal(recipientEligibility(undefined, 0, criteria).ok, false, 'removed from the contacts');
  const blocked = recipientEligibility(person({ blockedReason: 'Se dio de baja' }), 1, criteria);
  assert.ok(!blocked.ok && blocked.message.startsWith('Se dio de baja'));
  const replied = recipientEligibility(person({ replied: true }), 1, criteria);
  assert.ok(!replied.ok && /Respondió/.test(replied.message), 'a reply stops the follow-ups');
  const strict = { ...criteria, titles: ['Gerente General'] };
  assert.equal(recipientEligibility(person(), 0, strict).ok, false, 'a first message re-checks the approved criteria');
  assert.equal(recipientEligibility(person(), 1, strict).ok, true, 'follow-ups are not re-filtered by criteria');
  for (const result of [blocked, replied]) if (!result.ok) assert.equal(result.code, 'BULK_CAMPAIGN_RECIPIENT_CHANGED');
});

test('progress: ready, waiting, done and held for review, from deliveries and attempts', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');
  const recipient = (email: string) => ({ email, messages: [
    { draftId: `${email}-1`, versionId: 'v', delayDays: 0, subject: 's', body: 'b' },
    { draftId: `${email}-2`, versionId: 'v', delayDays: 3, subject: 's', body: 'b' },
  ] });
  const campaign = { approved_at: '2026-09-01T00:00:00Z', recipients: ['ready', 'cooling', 'held', 'followup', 'done', 'unknown'].map(recipient) } as unknown as BulkCampaign;
  const deliveries = [
    { draft_id: 'followup-1', status: 'sent', completed_at: '2026-09-09T12:00:00Z', error_message: null }, // follow-up due 09-12
    { draft_id: 'done-1', status: 'sent', completed_at: '2026-09-02T00:00:00Z', error_message: null },
    { draft_id: 'done-2', status: 'sent', completed_at: '2026-09-06T00:00:00Z', error_message: null },
    { draft_id: 'unknown-1', status: 'unknown', completed_at: null, error_message: 'unconfirmed' },
  ];
  const attempts = [
    { draft_id: 'cooling-1', state: 'retry_wait' as const, code: 'quota', message: 'Wait', retry_at: '2026-09-11T00:00:00Z', updated_at: null },
    { draft_id: 'held-1', state: 'attention' as const, code: 'BULK_CAMPAIGN_RECIPIENT_CHANGED', message: 'Respondió', retry_at: null, updated_at: null },
  ];
  assert.deepEqual(campaignProgress(campaign, deliveries, attempts, now), { ready: 1, waiting: 2, done: 1, attention: 2, total: 6 });
});

test('the screen sends in server batches and the old per-recipient route shares the same check', () => {
  const screen = readFileSync('src/components/campaigns/BulkCampaignWorkspace.tsx', 'utf8');
  assert.match(screen, /request\(`\/\$\{campaign\.id\}\/dispatch`, \{ reviewHash: campaign\.review_hash \}\)/);
  assert.doesNotMatch(screen, /\/process`/, 'no request per recipient from the browser');
  const processRoute = readFileSync('src/app/api/campaigns/bulk/[id]/process/route.ts', 'utf8');
  assert.match(processRoute, /recipientEligibility\(current, next\.index, campaign\.definition\.criteria\)/);
  const dispatchRoute = readFileSync('src/app/api/campaigns/bulk/[id]/dispatch/route.ts', 'utf8');
  assert.match(dispatchRoute, /campaign\.review_hash !== body\.reviewHash/, 'only the approved review can be dispatched');
  assert.match(dispatchRoute, /list: async \(\) => \[campaign\]/, 'only the campaign of the request, already scoped to its owner');
});
