import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkBatchReport, readCoworkNextTouch, readCoworkRetryReview, readCoworkCompanyPlan } from './batch-reads';
import { santiagoDayBounds } from '@/lib/cowork/send-cadence';

const CAMPAIGN = '00000000-0000-4000-8000-000000000010';
const scope = { userId: 'owner', organizationId: 'org' };
const delays = [0, 2, 4, 4, 5, 7, 15];

function messages(prefix: string) {
  return delays.map((delayDays, index) => ({ subject: `Asunto ${index}`, body: 'cuerpo', delayDays,
    draftId: `${prefix}-draft-${index}`, versionId: `${prefix}-v-${index}` }));
}
const campaign = {
  id: CAMPAIGN, organization_id: 'org', user_id: 'owner', revision: 1, status: 'approved',
  definition: { name: 'Lote 7', provider: 'google', messages: delays.map(delayDays => ({ subject: 's', body: 'b', delayDays })) },
  recipients: [
    { email: 'ana@acme.cl', name: 'Ana', company: 'Acme', leadRef: 'lead-a', messages: messages('a') },
    { email: 'luis@acme.cl', name: 'Luis', company: 'Acme', leadRef: 'lead-b', messages: messages('b') },
    { email: 'mia@beta.cl', name: 'Mia', company: 'Beta', leadRef: 'lead-c', messages: messages('c') },
  ],
  review_hash: 'x', approved_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
};

const rows: Record<string, unknown[]> = {
  leads: campaign.recipients.map(person => ({ id: person.leadRef, email: person.email, company: person.company })),
  outbound_dispatches: [
    { draft_id: 'a-draft-0', status: 'sent', completed_at: '2026-09-01T12:00:00Z', error_message: null, error_code: null, provider_message_id: 'gmail-1' },
    { draft_id: 'a-draft-1', status: 'failed', completed_at: '2026-09-03T12:00:00Z', error_message: 'El contacto se dio de baja.', error_code: 'recipient_suppressed', provider_message_id: null },
    { draft_id: 'b-draft-0', status: 'sent', completed_at: '2026-09-01T12:00:00Z', error_message: null, error_code: null, provider_message_id: 'gmail-2' },
  ],
  bulk_campaign_attempts: [
    { draft_id: 'b-draft-1', state: 'retry_wait', code: 'daily_quota_exceeded', message: 'cuota', retry_at: '2026-09-23T12:00:00Z', updated_at: '2026-09-22T10:00:00Z' },
  ],
  contacted_leads: [
    { email: 'ana@acme.cl', status: 'sent', sent_at: '2026-09-01T12:00:00Z', replied_at: null, reply_intent: null },
    { email: 'jefa@acme.cl', company: 'Acme', status: 'replied', sent_at: '2026-09-01T12:00:00Z', replied_at: '2026-09-20T10:00:00Z', reply_intent: 'positive' },
  ],
  unified_crm_data: [{ id: 'lead_saved|lead-a', stage: 'negotiation' }],
  cowork_send_batches: [],
  cowork_company_send_days: [],
};

function mockClient() {
  return { from(table: string) {
    const filters: Array<(row: any) => boolean> = [];
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; },
      ilike(key: string, pattern: string) {
        const value = pattern.replace(/^%/, '').toLowerCase();
        filters.push(row => pattern.startsWith('%') ? String(row[key] || '').toLowerCase().endsWith(value)
          : String(row[key] || '').toLowerCase() === value);
        return chain;
      },
      eq(key: unknown, value: unknown) {
        if (key === 'organization_id') assert.equal(value, 'org');
        return chain;
      },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return chain; },
      not(key: string) { filters.push(row => row[key] != null); return chain; },
      gte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() {
        if (table === 'bulk_campaigns') return { data: campaign, error: null };
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => void) { resolve({ data: (rows[table] || []).filter(row => filters.every(filter => filter(row))), error: null }); },
    };
    return chain;
  } };
}

test('batch report records every touch with cadence and account flags', async () => {
  const report = await readCoworkBatchReport(mockClient() as never, scope, CAMPAIGN) as any;
  assert.equal(report.campaign.cadence, 'seven_touch');
  assert.equal(report.summary.sent, 2);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.deferred, 1);
  const ana = report.recipients.find((person: any) => person.email === 'ana@acme.cl');
  assert.equal(ana.touches.length, 7);
  assert.equal(ana.touches[0].providerMessageId, 'gmail-1');
  assert.equal(ana.touches[1].retryAction, 'terminal');
  assert.equal(ana.touches[1].sentAt, null);
  assert.equal(ana.touches[0].draftId, 'a-draft-0');
  assert.equal(ana.touches[0].versionId, 'a-v-0');
  assert.equal(report.summary.uncertain, 0, 'planned touches are not uncertain deliveries');
  assert.equal(report.campaign.sender.verified, false);
  assert.equal(ana.flags.companyReplied.email, 'jefa@acme.cl');
  assert.deepEqual(ana.flags.negotiationStages, ['negotiation']);
});

test('next touch blocks replied and negotiating accounts, frees the rest', async () => {
  const review = await readCoworkNextTouch(mockClient() as never, scope, CAMPAIGN) as any;
  assert.equal(review.timeZone, 'America/Santiago');
  const ana = review.items.find((item: any) => item.email === 'ana@acme.cl');
  assert.ok(ana.blockedBy.includes('company_replied'));
  assert.ok(ana.blockedBy.some((reason: string) => reason.startsWith('negotiation:')));
  const mia = review.items.find((item: any) => item.email === 'mia@beta.cl');
  assert.equal(mia.done, false);
  assert.equal(mia.next.touchNumber, 1);
  assert.equal(mia.next.eligible, true);
  assert.ok(mia.next.dueAtSantiago);
});

test('retry review separates retryable, terminal and reconcile-first', async () => {
  const review = await readCoworkRetryReview(mockClient() as never, scope, CAMPAIGN) as any;
  assert.equal(review.summary.retryable >= 1, true);
  assert.equal(review.summary.terminal >= 1, true);
  const quota = review.items.find((item: any) => item.reason === 'daily_quota_exceeded');
  assert.equal(quota.action, 'retry');
  const suppressed = review.items.find((item: any) => item.reason === 'recipient_suppressed');
  assert.equal(suppressed.action, 'terminal');
  assert.ok(review.items.every((item: any) => item.idempotencyNote.includes('bulk:campaign:draft')));
});

test('company plan staggers one company per day from today', async () => {
  const plan = await readCoworkCompanyPlan(mockClient() as never, scope, CAMPAIGN) as any;
  assert.equal(plan.startDay, santiagoDayBounds(new Date()).day);
  const days = Object.fromEntries(plan.assignments.map((item: any) => [item.email, item.sendDay]));
  assert.equal(days['ana@acme.cl'], plan.startDay);
  assert.ok(days['luis@acme.cl'] > days['ana@acme.cl']);
  assert.equal(days['mia@beta.cl'], plan.startDay);
  assert.equal(plan.scheduled, false);
});

test('reads refuse other organizations campaigns', async () => {
  const empty = { from() {
    const chain: Record<string, (...args: any[]) => any> = {
      select() { return chain; }, eq() { return chain; }, in() { return chain; },
      not() { return chain; }, gte() { return chain; }, order() { return chain; },
      limit() { return chain; },
      async maybeSingle() { return { data: null, error: null }; },
      then(resolve: (value: unknown) => void) { resolve({ data: [], error: null }); },
    };
    return chain;
  } };
  await assert.rejects(readCoworkBatchReport(empty as never, scope, CAMPAIGN));
});
