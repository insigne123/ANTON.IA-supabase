import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MessagingDraftV1Schema } from '@/lib/messaging-contracts';
import {
  SupliaReviewInboxError,
  approveSupliaReviewEmail,
  createAntoniaReportReviewPreview,
  listSupliaReviewItems,
  normalizeSupliaReviewResolutionNote,
} from './suplia-review-inbox';

const organizationId = '30000000-0000-4000-8000-000000000001';
const userId = '30000000-0000-4000-8000-000000000002';

function readyDraft() {
  return MessagingDraftV1Schema.parse({
    schemaVersion: 1,
    draftId: '30000000-0000-4000-8000-000000000010',
    versionId: '30000000-0000-4000-8000-000000000011',
    organizationId,
    userId,
    researchSnapshotId: null,
    revision: 2,
    parentVersionId: '30000000-0000-4000-8000-000000000012',
    lifecycle: 'ready',
    channel: 'email',
    recipient: {
      leadRef: 'ada@example.com',
      displayName: 'Ada',
      email: 'ada@example.com',
      linkedinUrl: null,
    },
    content: {
      subject: 'Follow up',
      text: 'Hello Ada\n\nUnsubscribe: https://app.test/unsubscribe?t=token',
      html: '<p>Hello Ada</p><a href="https://app.test/unsubscribe?t=token">Unsubscribe</a>',
    },
    approval: {
      status: 'approved',
      decidedBy: userId,
      decidedAt: '2026-08-23T12:05:00.000Z',
      reason: null,
    },
    preflight: {
      status: 'passed',
      checkedAt: '2026-08-23T12:05:00.000Z',
      errors: [],
      warnings: [],
    },
    createdAt: '2026-08-23T12:05:00.000Z',
  });
}

function reviewRow(draftId: string) {
  return {
    id: '30000000-0000-4000-8000-000000000020',
    organization_id: organizationId,
    item_type: 'outbound_email',
    messaging_draft_id: draftId,
    antonia_report_id: null,
    requested_by_user_id: userId,
    sender_user_id: userId,
    title: 'Email review: Ada',
    summary: 'Follow up',
    status: 'pending',
    severity: 'normal',
    metadata: {},
    reviewed_by_user_id: null,
    reviewed_at: null,
    resolution_note: null,
    created_at: '2026-08-23T12:00:00.000Z',
    updated_at: '2026-08-23T12:00:00.000Z',
  };
}

function readyApprovalAdmin(review: ReturnType<typeof reviewRow>) {
  let updatedPayload: Record<string, unknown> | null = null;
  let rpcCalls = 0;

  return {
    admin: {
      from(table: string) {
        assert.equal(table, 'suplia_review_items');
        let isUpdate = false;
        const query = {
          select() { return query; },
          eq() { return query; },
          in() { return query; },
          update(payload: Record<string, unknown>) {
            isUpdate = true;
            updatedPayload = payload;
            return query;
          },
          async maybeSingle() {
            return isUpdate
              ? { data: { id: review.id }, error: null }
              : { data: review, error: null };
          },
        };
        return query;
      },
      async rpc() {
        rpcCalls += 1;
        throw new Error('approval RPC must not run for an already approved current draft');
      },
    },
    get updatedPayload() { return updatedPayload; },
    get rpcCalls() { return rpcCalls; },
  };
}

test('ANTONIA report inbox previews never retain report HTML', () => {
  const preview = createAntoniaReportReviewPreview({
    type: 'daily',
    content: '<style>.hidden { display:none }</style><h1>Daily report</h1><script>alert(1)</script><p>42 leads contacted.</p>',
    summaryData: { severity: 'attention' },
  });

  assert.equal(preview.title, 'ANTONIA report: daily');
  assert.equal(preview.summary, 'Daily report 42 leads contacted.');
  assert.equal(preview.severity, 'attention');
  assert.equal(preview.summary.includes('<'), false);
});

test('SUPL.IA review resolution notes are concise plain text', () => {
  assert.equal(normalizeSupliaReviewResolutionNote('  Reviewed\nby owner  '), 'Reviewed by owner');
  assert.equal(normalizeSupliaReviewResolutionNote('   '), null);
  assert.throws(
    () => normalizeSupliaReviewResolutionNote('x'.repeat(501)),
    /at most 500 characters/i,
  );
});

test('SUPL.IA review lists scope outbound items to the authenticated owner before limiting', async () => {
  const filters: Array<[string, string]> = [];
  const query: any = {
    select() { return query; },
    eq(column: string, value: string) {
      filters.push([column, value]);
      return query;
    },
    or(value: string) {
      filters.push(['or', value]);
      return query;
    },
    order() { return query; },
    limit() { return Promise.resolve({ data: [], error: null }); },
  };
  const admin = {
    from(table: string) {
      assert.equal(table, 'suplia_review_items');
      return query;
    },
  };

  const items = await listSupliaReviewItems({ organizationId, userId }, { admin });

  assert.deepEqual(items, []);
  assert.deepEqual(filters, [
    ['organization_id', organizationId],
    ['or', `item_type.eq.antonia_report,and(item_type.eq.outbound_email,sender_user_id.eq.${userId})`],
  ]);
});

test('SUPL.IA inbox migration does not grant cross-owner outbound reads', () => {
  const migration = readFileSync('supabase/migrations/20260823110000_suplia_review_inbox.sql', 'utf8');

  assert.match(migration, /item_type = 'outbound_email'\s+and suplia_review_items\.sender_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /or suplia_review_items\.item_type = 'antonia_report'/);
});

test('SUPL.IA inbox migration queues and backfills ANTONIA reports without copying report HTML', () => {
  const reportQueueSection = readFileSync('supabase/migrations/20260823113000_enqueue_antonia_report_review_items.sql', 'utf8');

  assert.match(reportQueueSection, /security definer/);
  assert.match(reportQueueSection, /after insert on public\.antonia_reports/);
  assert.match(reportQueueSection, /from public\.antonia_reports report/);
  assert.doesNotMatch(reportQueueSection, /report\.content|new\.content/);
});

test('SUPL.IA repairs a pending inbox row for an already-approved current draft without another RPC', async () => {
  const draft = readyDraft();
  const fake = readyApprovalAdmin(reviewRow(draft.draftId));

  const result = await approveSupliaReviewEmail({
    organizationId,
    userId,
    reviewId: '30000000-0000-4000-8000-000000000020',
    versionId: draft.versionId,
  }, {
    admin: fake.admin,
    getCurrentDraft: async () => draft,
    now: () => '2026-08-23T12:10:00.000Z',
  });

  assert.equal(result.versionId, draft.versionId);
  assert.equal(fake.rpcCalls, 0);
  assert.deepEqual(fake.updatedPayload, {
    status: 'approved',
    reviewed_by_user_id: userId,
    reviewed_at: '2026-08-23T12:10:00.000Z',
    resolution_note: null,
  });
});

test('SUPL.IA keeps the original draft version stale after a ready child is current', async () => {
  const draft = readyDraft();
  const fake = readyApprovalAdmin(reviewRow(draft.draftId));

  await assert.rejects(
    () => approveSupliaReviewEmail({
      organizationId,
      userId,
      reviewId: '30000000-0000-4000-8000-000000000020',
      versionId: draft.parentVersionId!,
    }, {
      admin: fake.admin,
      getCurrentDraft: async () => draft,
      now: () => '2026-08-23T12:10:00.000Z',
    }),
    (error: unknown) => error instanceof SupliaReviewInboxError && error.status === 409,
  );
  assert.equal(fake.rpcCalls, 0);
  assert.equal(fake.updatedPayload, null);
});
