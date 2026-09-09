import test from 'node:test';
import assert from 'node:assert/strict';
import { runBulkCampaignWorker, type BulkWorkerDependencies } from './bulk-campaign-worker';
import type { BulkCampaign } from '../bulk-campaigns';

function campaign(id: string): BulkCampaign {
  return { id, status: 'approved', approved_at: '2026-09-01T00:00:00Z', recipients: ['one', 'two'].map(email => ({ email,
    messages: [{ draftId: `${id}-${email}`, versionId: 'v1', delayDays: 0, subject: 'Hi', body: 'Hello' }],
  })) } as BulkCampaign;
}
function fixture(overrides: Partial<BulkWorkerDependencies> = {}) {
  const sent: string[] = [], touched: string[] = [];
  const deps: BulkWorkerDependencies = {
    now: () => Date.parse('2026-09-10'), list: async () => [campaign('a'), campaign('b')], deliveries: async () => [], attempts: async () => [],
    send: async (_campaign, message) => { sent.push(message.draftId); return { status: 'sent' } as any; },
    touch: async value => { touched.push(value.id); }, ...overrides,
  };
  return { deps, sent, touched };
}
test('worker sends approved due messages without relying on browser state', async () => {
  const { deps, sent, touched } = fixture();
  const result = await runBulkCampaignWorker(deps);
  assert.equal(result.sent, 4); assert.equal(sent.length, 4); assert.deepEqual(touched, ['a', 'b']);
});
test('unknown delivery is not retried; partial failure does not stop other recipients', async () => {
  const { deps, sent } = fixture({ deliveries: async value => value.id === 'a' ? [{ draft_id: 'a-one', status: 'unknown', completed_at: null, error_message: 'unconfirmed' }] : [] });
  const result = await runBulkCampaignWorker(deps);
  assert.equal(result.sent, 3); assert.equal(sent.includes('a-one'), false);
});
test('quota deferral stops that campaign and rotates to another campaign', async () => {
  const { deps, touched } = fixture({ send: async value => ({ status: value.id === 'a' ? 'deferred' : 'sent' }) as any });
  const result = await runBulkCampaignWorker(deps);
  assert.equal(result.deferred, 1); assert.equal(result.sent, 2); assert.deepEqual(touched, ['a', 'b']);
});
test('worker does not send paused batches and honors request budget', async () => {
  const { deps, sent } = fixture({ list: async () => [{ ...campaign('a'), status: 'paused' }] });
  assert.equal((await runBulkCampaignWorker(deps)).attempted, 0);
  assert.equal((await runBulkCampaignWorker({ ...deps, list: async () => [campaign('a')] }, 0)).attempted, 0);
  assert.equal(sent.length, 0);
});
test('one unavailable campaign cannot stop unrelated campaigns', async () => {
  const { deps, sent, touched } = fixture({ deliveries: async value => { if (value.id === 'a') throw new Error('query failed'); return []; } });
  const result = await runBulkCampaignWorker(deps);
  assert.equal(result.attention, 1); assert.equal(result.sent, 2);
  assert.deepEqual(sent, ['b-one', 'b-two']); assert.deepEqual(touched, ['a', 'b']);
});
test('worker skips persistent attention and retry cooldown but resumes an expired cooldown', async () => {
  const { deps, sent } = fixture({ attempts: async value => value.id === 'a' ? [
    { draft_id: 'a-one', state: 'attention', code: 'blocked', message: 'Blocked', retry_at: null, updated_at: null },
    { draft_id: 'a-two', state: 'retry_wait', code: 'quota', message: 'Wait', retry_at: '2026-09-11T00:00:00Z', updated_at: null },
  ] : [{ draft_id: 'b-one', state: 'retry_wait', code: 'quota', message: 'Wait', retry_at: '2026-09-09T00:00:00Z', updated_at: null }] });
  assert.equal((await runBulkCampaignWorker(deps)).sent, 2);
  assert.deepEqual(sent, ['b-one', 'b-two']);
});
test('a sent marker completes the sequence when retention removed the dispatch row', async () => {
  const { deps, sent } = fixture({ deliveries: async () => [],
    attempts: async () => [{ draft_id: 'a-one', state: 'sent', code: 'sent', message: 'Envío confirmado.', retry_at: null, updated_at: '2026-09-05T00:00:00Z' }] });
  const result = await runBulkCampaignWorker(deps);
  // a-one counts as sent (follow-up cadence derives from it); only a-two sends per campaign.
  assert.deepEqual(sent.sort(), ['a-two', 'b-one', 'b-two']);
  assert.equal(result.sent, 3);
});
