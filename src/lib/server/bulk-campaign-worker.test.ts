import test from 'node:test';
import assert from 'node:assert/strict';
import { runBulkCampaignWorker, type BulkWorkerDependencies } from './bulk-campaign-worker';
import { defaultAudience, type AudiencePerson, type BulkCampaign } from '../bulk-campaigns';

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

test('spaced batches attempt only one recipient per pass and fail closed on spacing read errors', async () => {
  const spaced = fixture({ batchSpacing: async () => 30 });
  assert.equal((await runBulkCampaignWorker(spaced.deps)).sent, 2);
  assert.deepEqual(spaced.sent, ['a-one', 'b-one']);
  const unavailable = fixture({ batchSpacing: async () => { throw new Error('offline'); } });
  assert.equal((await runBulkCampaignWorker(unavailable.deps)).sent, 0);
  assert.deepEqual(unavailable.sent, []);
  const recent = fixture({ batchSpacing: async () => 30, deliveries: async value => [{
    draft_id: `${value.id}-one`, status: 'sent', completed_at: '2026-09-09T23:45:00Z', error_message: null,
  }] });
  assert.equal((await runBulkCampaignWorker(recent.deps)).sent, 0);
});

// Plan 9, PR-16: the worker also runs for one campaign from «Enviar correos disponibles» (…/dispatch), so it re-checks the
// audience before each send, as the per-recipient route did, and a request and the cron can overlap without a double send.
const audienceOf = (emails: string[], overrides: Record<string, Partial<AudiencePerson>> = {}) => async () => emails.map(email => ({
  email, name: email, company: 'Retail Andino', title: 'Gerente', industry: 'Retail', country: 'Chile', size: '201-500', seniority: 'manager',
  leadRef: email, lastSentAt: null, contacted: false, replied: false, blockedReason: null, reasons: [], enriched: true, ...overrides[email],
}) as AudiencePerson);
const withCriteria = (value: BulkCampaign) => ({ ...value, definition: { criteria: defaultAudience } }) as unknown as BulkCampaign;

test('a contact who left the audience or got blocked is held for review, not sent, and not retried each pass', async () => {
  const held: string[] = [];
  let reads = 0;
  const { deps, sent } = fixture({
    list: async () => [withCriteria(campaign('a'))],
    audience: async () => { reads++; return audienceOf(['one'], { one: { blockedReason: 'Se dio de baja' } })(); },
    hold: async (_campaign, message, check) => { held.push(`${message.draftId}:${check.code}`); },
  });
  const result = await runBulkCampaignWorker(deps);
  assert.deepEqual(sent, []);
  assert.equal(result.held, 2);
  assert.deepEqual(held, ['a-one:BULK_CAMPAIGN_RECIPIENT_CHANGED', 'a-two:BULK_CAMPAIGN_RECIPIENT_CHANGED']);
  assert.equal(reads, 1, 'the audience is read once per campaign');
});

test('a reply stops the follow-up but not the first message of someone else', async () => {
  const value = withCriteria({ ...campaign('a'), recipients: [
    { email: 'one', messages: [{ draftId: 'a-one-1', versionId: 'v1', delayDays: 0, subject: 'Hi', body: 'Hello' }, { draftId: 'a-one-2', versionId: 'v1', delayDays: 1, subject: 'Re', body: 'Again' }] },
    { email: 'two', messages: [{ draftId: 'a-two-1', versionId: 'v1', delayDays: 0, subject: 'Hi', body: 'Hello' }] },
  ] } as BulkCampaign);
  const { deps, sent } = fixture({
    list: async () => [value],
    deliveries: async () => [{ draft_id: 'a-one-1', status: 'sent', completed_at: '2026-09-01T00:00:00Z', error_message: null }],
    audience: audienceOf(['one', 'two'], { one: { replied: true, contacted: true } }),
    hold: async () => {},
  });
  const result = await runBulkCampaignWorker(deps);
  assert.deepEqual(sent, ['a-two-1']);
  assert.equal(result.held, 1);
});

test('nothing due, no audience read; and one call stops at its own limit', async () => {
  let reads = 0;
  const idle = fixture({ list: async () => [withCriteria(campaign('a'))], audience: async () => { reads++; return []; },
    deliveries: async () => [{ draft_id: 'a-one', status: 'sent', completed_at: '2026-09-01T00:00:00Z', error_message: null }, { draft_id: 'a-two', status: 'sent', completed_at: '2026-09-01T00:00:00Z', error_message: null }] });
  await runBulkCampaignWorker(idle.deps);
  assert.equal(reads, 0);
  const capped = fixture();
  assert.equal((await runBulkCampaignWorker(capped.deps, 45000, 3)).attempted, 3);
  assert.equal(capped.sent.length, 3);
});

test('a request and the cron running together send each message once (same durable key)', async () => {
  // Stand-in for outbound_dispatches: the first claim of a key sends, a later one replays the stored outcome.
  const claims = new Map<string, Promise<{ status: 'sent' }>>();
  const providerCalls: string[] = [];
  const send: BulkWorkerDependencies['send'] = async (value, message) => {
    const key = `bulk:${value.id}:${message.draftId}`;
    if (!claims.has(key)) claims.set(key, (async () => { providerCalls.push(key); await new Promise(done => setTimeout(done, 5)); return { status: 'sent' as const }; })());
    return (await claims.get(key)) as any;
  };
  const shared = { list: async () => [campaign('a'), campaign('b')], send };
  const request = fixture(shared);
  const cron = fixture(shared);
  const [fromRequest, fromCron] = await Promise.all([runBulkCampaignWorker(request.deps), runBulkCampaignWorker(cron.deps)]);
  assert.equal(providerCalls.length, 4, 'four messages, four provider calls');
  assert.equal(new Set(providerCalls).size, 4);
  assert.equal(fromRequest.sent + fromCron.sent, 8, 'both runs report the confirmed send; only one reached the provider');
});
