import assert from 'node:assert/strict';
import test from 'node:test';

import { memory } from './goals-alerts-test-fixtures';
import { readCreditResults } from './credit-results';

const ORG = 'org-1';
const callback = (id: string, user: string, table: string, target: string, person: string, email: boolean, phone: boolean, at: string, state: string | null = null) => ({
  id, organization_id: ORG, user_id: user, target_table: table, target_lead_id: target, apollo_person_id: person, reveal_email: email, reveal_phone: phone, terminal_state: state, created_at: at,
});

const seed = () => ({
  apollo_enrichment_callbacks: [
    callback('c1', 'u-ana', 'people_search_leads', 's1', 'p1', true, true, '2026-10-05T12:00:00Z'),
    callback('c2', 'u-ana', 'enriched_leads', 'e2', 'p2', true, false, '2026-10-20T12:00:00Z'),
    callback('c3', 'u-ana', 'people_search_leads', 's3', 'p3', true, true, '2026-10-28T12:00:00Z'),
    callback('c4', 'u-leo', 'people_search_leads', 's4', 'p4', false, true, '2026-10-06T12:00:00Z', 'failed'), // not charged
    callback('c5', 'u-leo', 'people_search_leads', 's5', 'p1', false, true, '2026-10-10T12:00:00Z'), // the same person, paid again
    callback('c6', 'u-ana', 'people_search_leads', 's6', 'p6', true, false, '2026-09-20T12:00:00Z'), // before the period
    callback('c7', 'u-leo', 'enriched_leads', 'e7', 'p7', true, false, '2026-10-01T12:00:00Z'),
    { ...callback('c8', 'u-x', 'enriched_leads', 'ex', 'px', true, true, '2026-10-05T12:00:00Z'), organization_id: 'org-2' }, // another company
  ],
  people_search_leads: [
    { id: 's1', organization_id: ORG, email: 'uno@a.cl', source_provider_id: 'p1' },
    { id: 's3', organization_id: ORG, email: null, source_provider_id: 'p3' },
    { id: 's5', organization_id: ORG, email: 'uno@a.cl', source_provider_id: 'p1' },
  ],
  enriched_leads: [
    { id: 'e2', organization_id: ORG, email: 'dos@a.cl', source_provider_id: 'p2' },
    { id: 'e1', organization_id: ORG, email: 'Uno@A.cl', source_provider_id: 'p1' }, // the saved copy of a searched person
    { id: 'e7', organization_id: ORG, email: 'siete@a.cl', source_provider_id: 'p7' },
  ],
  contacted_leads: [
    { organization_id: ORG, email: 'dos@a.cl', sent_at: '2026-10-21T12:00:00Z', replied_at: '2026-10-22T12:00:00Z', reply_intent: 'meeting_request' },
    { organization_id: ORG, email: 'otro@a.cl', sent_at: '2026-10-21T12:00:00Z', replied_at: null, reply_intent: null },
  ],
  contact_calls: [
    { organization_id: ORG, lead_id: 'e1', provider_person_id: 'p1', outcome: 'answered' },
    { organization_id: ORG, lead_id: null, provider_person_id: 'p3', outcome: 'no_answer' },
    { organization_id: ORG, lead_id: 'e7', provider_person_id: 'p7', outcome: null }, // started, never told
  ],
});

const RANGE = { organizationId: ORG, from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z', now: new Date('2026-11-02T15:00:00Z') };

test('the credits of the period, the people paid for and what happened with them, by whoever paid first', async () => {
  const { client } = memory(seed());
  const results = await readCreditResults(client, RANGE);
  assert.deepEqual(results.people, [
    // p1 called and answered, p2 written to with a meeting asked, p3 called without an answer; 9 + 1 + 9 credits.
    { userId: 'u-ana', credits: 19, paid: 3, withPhone: 2, contacted: 3, conversations: 2, meetings: 1, waiting: 0 },
    // Leo paid 8 for p1 again (Ana paid it first) and 1 for p7, untouched for a month; the failed lookup costs nothing.
    { userId: 'u-leo', credits: 9, paid: 1, withPhone: 0, contacted: 0, conversations: 0, meetings: 0, waiting: 1 },
  ]);
  assert.deepEqual(results.totals, { credits: 28, paid: 4, withPhone: 2, contacted: 3, conversations: 2, meetings: 1, waiting: 1 });
});

test('a team or one person narrows it, and a period without credits is empty', async () => {
  const { client } = memory(seed());
  const leo = await readCreditResults(client, { ...RANGE, userIds: ['u-leo'] });
  assert.deepEqual(leo.people.map(person => person.userId), ['u-leo']);
  assert.equal(leo.people[0].paid, 2, 'alone, Leo is the first to pay for p1');
  const empty = await readCreditResults(client, { ...RANGE, from: '2026-12-01T03:00:00.000Z', to: '2027-01-01T03:00:00.000Z' });
  assert.deepEqual(empty, { totals: { credits: 0, paid: 0, withPhone: 0, contacted: 0, conversations: 0, meetings: 0, waiting: 0 }, people: [] });
});

test('before the calls table exists the emails still count', async () => {
  const { client } = memory(seed(), { missing: ['contact_calls'] });
  const results = await readCreditResults(client, RANGE);
  assert.deepEqual(results.totals, { credits: 28, paid: 4, withPhone: 2, contacted: 1, conversations: 1, meetings: 1, waiting: 2 });
});
