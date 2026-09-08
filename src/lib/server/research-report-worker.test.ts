import assert from 'node:assert/strict';
import test from 'node:test';

import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';
import { processResearchReportSynthesisQueue } from '@/lib/server/research-report-worker';

function adminFixture(candidates: Array<Record<string, string>>, snapshot: unknown = draftSnapshotFixture()) {
  return {
    from(table: string) {
      if (table === 'research_report_synthesis_states') {
        const builder: any = {
          select() { return builder; },
          or() { return builder; },
          order() { return builder; },
          limit() { return builder; },
          eq() { return builder; },
          then(resolve: (value: unknown) => void) { resolve({ data: candidates, error: null }); },
        };
        return builder;
      }
      const builder: any = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() { return { data: snapshot ? { payload: snapshot } : null, error: null }; },
      };
      return builder;
    },
  };
}

const candidate = (schemaVersion: string) => ({
  id: `state-${schemaVersion}`,
  research_snapshot_id: draftSnapshotFixture().id,
  organization_id: draftSnapshotFixture().scope.organizationId!,
  user_id: draftSnapshotFixture().scope.ownerUserId,
  schema_version: schemaVersion,
});

test('dispatches queued Report V2 work with organization configuration and suppressed shadow delivery', async () => {
  let deliveryState = '';
  let recordedMetrics: unknown = null;
  const result = await processResearchReportSynthesisQueue({}, {
    admin: adminFixture([candidate('research-report-document/v2')]),
    loadV2Configuration: (async () => ({
      mode: 'shadow',
      sellerProfile: { companyName: 'Northstar', products: [{ key: 'ops' }] },
      icpRules: null,
      profileRevision: 1,
      synthesisContextHash: 'a'.repeat(64),
    })) as any,
    processV2: (async (input: any) => {
      deliveryState = input.deliveryState;
      return {
        document: {},
        synthesis: { status: 'completed', retryable: false },
        metrics: { sectionAcceptRate: 1, claimsPerSource: {}, ownDomainSourceRatio: 0, signalsWithDateCount: 0, committeeMembersFound: 0 },
      };
    }) as any,
    recordV2Metrics: async ({ result: attempt }) => { recordedMetrics = attempt.metrics; },
    rejectCandidate: async () => null,
  });

  assert.equal(deliveryState, 'suppressed');
  assert.deepEqual(recordedMetrics, { sectionAcceptRate: 1, claimsPerSource: {}, ownDomainSourceRatio: 0, signalsWithDateCount: 0, committeeMembersFound: 0 });
  assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0, skipped: 0 });
});

test('isolates a failed V2 candidate and continues processing V1 work', async () => {
  let v1Processed = 0;
  const result = await processResearchReportSynthesisQueue({}, {
    admin: adminFixture([
      candidate('research-report-document/v2'),
      candidate('research-report-document/v1'),
    ]),
    loadV2Configuration: (async () => ({
      mode: 'visible',
      sellerProfile: { products: [{ key: 'ops' }] },
      icpRules: null,
      profileRevision: 1,
      synthesisContextHash: 'b'.repeat(64),
    })) as any,
    processV2: (async () => { throw new Error('fixture V2 failure'); }) as any,
    loadV1SellerProfile: (async () => ({ companyName: 'Northstar', services: ['Automation'] })) as any,
    processV1: (async () => {
      v1Processed += 1;
      return { document: {}, synthesis: { status: 'completed', retryable: false } };
    }) as any,
    rejectCandidate: async () => null,
  });

  assert.equal(v1Processed, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
});

test('does not process V2 when the organization rollout is off', async () => {
  let processed = 0;
  let rejection: any = null;
  const result = await processResearchReportSynthesisQueue({}, {
    admin: adminFixture([candidate('research-report-document/v2')]),
    loadV2Configuration: (async () => ({
      mode: 'off',
      sellerProfile: { products: [{ key: 'ops' }] },
      icpRules: null,
      profileRevision: 1,
      synthesisContextHash: 'c'.repeat(64),
    })) as any,
    processV2: (async () => { processed += 1; return null; }) as any,
    rejectCandidate: async (input) => { rejection = input; return null; },
  });

  assert.equal(processed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(rejection?.errorCode, 'report_v2_rollout_off');
  assert.equal(rejection?.retryable, false);
});

test('pre-claim snapshot failures consume a durable non-retryable candidate attempt', async () => {
  let rejection: any = null;
  const result = await processResearchReportSynthesisQueue({}, {
    admin: adminFixture([candidate('research-report-document/v2')], null),
    rejectCandidate: async (input) => { rejection = input; return null; },
  });

  assert.equal(result.failed, 1);
  assert.equal(rejection?.errorCode, 'research_report_candidate_invalid');
  assert.equal(rejection?.retryable, false);
});
