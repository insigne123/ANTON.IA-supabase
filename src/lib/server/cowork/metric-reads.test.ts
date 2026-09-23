import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMetricsChannels, readMetricsDiagnose, readMetricsIncidents, readMetricsRates } from './metric-reads';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

function mockClient(tables: Record<string, { rows?: unknown[]; count?: number; error?: { message: string } }> = {}) {
  const client = {
    from: (table: string) => {
      const state = tables[table] || {};
      const chain: Record<string, (...args: any[]) => any> = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        or: () => chain, gte: () => chain, in: () => chain, not: () => chain, is: () => chain,
        then: (resolve: (value: unknown) => void) => resolve(state.error
          ? { data: null, error: state.error }
          : { data: state.rows ?? [], error: null, count: state.count ?? (state.rows?.length || 0) }),
      };
      return chain;
    },
  } as never;
  return client;
}

const replied = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1', sent_at: daysAgo(2), replied_at: daysAgo(2), reply_intent: 'positive',
  bounced_at: null, delivery_status: 'replied', provider: 'gmail', ...overrides,
});

test('rates expose denominators and sources for both windows', async () => {
  const client = mockClient({
    contacted_leads: { rows: [replied(), replied({ id: 'c2', reply_intent: 'auto_reply' })] },
    unsubscribed_emails: { rows: [{ created_at: daysAgo(3) }] },
  });
  const result = await readMetricsRates(client, scope);
  assert.equal(result.scope, 'organization_metrics');
  assert.equal(result.last_7_days.sent, 2);
  assert.equal(result.last_7_days.humanReplies, 1);
  assert.equal(result.last_7_days.rates.reply.denominator, 2);
  assert.equal(result.last_7_days.rates.reply.source, 'contacted_leads');
  assert.equal(result.last_7_days.unsubscribed, 1);
  assert.ok(result.coverage);
});

test('rates stay generic on database errors', async () => {
  const client = mockClient({ contacted_leads: { error: { message: 'db down' } } });
  await assert.rejects(readMetricsRates(client, scope), /No se pudieron calcular las métricas/);
});

test('diagnose returns five hypotheses with limits', async () => {
  const client = mockClient({ contacted_leads: { rows: [replied()] } });
  const result = await readMetricsDiagnose(client, scope);
  assert.equal(result.hypotheses.length, 5);
  assert.ok(result.hypotheses.some((h) => h.id === 'message_length' && h.verdict === 'untestable'));
});

test('channels refuse comparison with empty linkedin outcomes', async () => {
  const client = mockClient({
    contacted_leads: { rows: [replied()] },
    cowork_linkedin_jobs: { rows: [] },
    cowork_linkedin_threads: { rows: [] },
    extension_linkedin_sends: { rows: [] },
    cowork_linkedin_sweep_state: { rows: [] },
  });
  const result = await readMetricsChannels(client, scope);
  assert.equal(result.verdict, 'not_comparable');
  assert.ok(result.reasons.includes('linkedin_sin_envios_confirmados'));
  assert.equal(result.linkedinDetail.positivesUnknown, true);
});

test('incidents combine steps, enrollments and contact states', async () => {
  const client = mockClient({
    campaign_recipient_steps: { rows: [{ id: 's1', enrollment_id: 'e1', state: 'approved', due_at: daysAgo(-1) }] },
    campaign_enrollments: { rows: [{ id: 'e1', recipient_email: 'ana@x.test', status: 'active' }] },
    contacted_leads: { rows: [{ email: 'ana@x.test' }] },
    unsubscribed_emails: { rows: [] },
    cowork_mailbox_sweep_state: { rows: [] },
    antonia_exceptions: { rows: [] },
  });
  const result = await readMetricsIncidents(client, scope);
  assert.equal(result.scope, 'organization_metrics');
  assert.equal(result.checks.length, 6);
  const scheduled = result.checks.find((c) => c.check === 'steps_scheduled_for_replied')!;
  assert.equal(scheduled.found, 1);
});
