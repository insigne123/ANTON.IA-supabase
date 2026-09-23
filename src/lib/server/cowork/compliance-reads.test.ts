import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readComplianceCheck, readComplianceLaw, readComplianceObligation } from './compliance-reads';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const LEAD = '00000000-0000-4000-8000-000000000001';

function mockClient(tables: Record<string, { rows?: unknown[]; error?: { message: string }; single?: unknown }> = {}) {
  const client = {
    from: (table: string) => {
      const state = tables[table] || {};
      const chain: Record<string, (...args: any[]) => any> = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        or: () => chain, gte: () => chain, in: () => chain, not: () => chain, is: () => chain, ilike: () => chain,
        maybeSingle: async () => ({ data: state.single ?? null, error: state.error || null }),
        then: (resolve: (value: unknown) => void) => resolve(state.error
          ? { data: null, error: state.error }
          : { data: state.rows ?? [], error: null }),
      };
      return chain;
    },
  } as never;
  return client;
}

test('law carries jurisdiction, dates and sources', async () => {
  const result = await readComplianceLaw();
  assert.equal(result.jurisdiction, 'CL');
  assert.equal(result.incoming.inForce, '2026-12-01');
  assert.ok(result.disclaimer.length > 10);
});

test('obligation disambiguates or falls back to base', async () => {
  const mining = await readComplianceObligation('minera de cobre');
  assert.equal(mining.disambiguated, true);
  const unknown = await readComplianceObligation('astrología cuántica');
  assert.equal(unknown.disambiguated, false);
  await assert.rejects(readComplianceObligation(''), /industria/);
});

test('check allows a clean contact', async () => {
  const client = mockClient({
    leads: { single: { id: LEAD, name: 'Ana', email: 'ana@acme.cl', company: 'Acme' } },
    unsubscribed_emails: { rows: [] },
    contacted_leads: { rows: [] },
    excluded_domains: { rows: [] },
  });
  const result = await readComplianceCheck(client, scope, LEAD);
  assert.equal(result.verdict, 'allow');
  assert.equal(result.policy, 'contact-policy/v1');
});

test('check blocks suppression and defers frequency', async () => {
  const blocked = mockClient({
    leads: { single: { id: LEAD, email: 'ana@acme.cl', company: 'Acme' } },
    unsubscribed_emails: { rows: [{ user_id: null, organization_id: null }] },
    contacted_leads: { rows: [] },
    excluded_domains: { rows: [] },
  });
  const unsub = await readComplianceCheck(blocked, scope, LEAD);
  assert.equal(unsub.verdict, 'block');
  assert.ok(unsub.reasons.includes('unsubscribed'));

  const deferred = mockClient({
    leads: { single: { id: LEAD, email: 'ana@acme.cl', company: 'Acme' } },
    unsubscribed_emails: { rows: [] },
    contacted_leads: { rows: [{ sent_at: new Date().toISOString(), replied_at: null, evaluation_status: null, company: 'Acme' }] },
    excluded_domains: { rows: [] },
  });
  const freq = await readComplianceCheck(deferred, scope, LEAD);
  assert.equal(freq.verdict, 'defer');
  assert.ok(freq.reasons.some((reason) => reason.startsWith('person_frequency')));
});
