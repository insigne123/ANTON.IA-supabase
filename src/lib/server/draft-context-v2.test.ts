import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_DRAFT_QUALITY_SCORE,
  buildDraftContextV2,
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
} from './draft-context-v2';
import {
  DRAFT_FIXTURE_NOW,
  draftSnapshotFixture,
} from './draft-v2-test-fixtures';
import { canonicalSha256 } from '@/lib/messaging-contracts';

function build(input: { includeRole?: boolean; capturedAt?: string; overallConfidence?: number } = {}) {
  const baseSnapshot = draftSnapshotFixture({ includeRole: input.includeRole });
  const snapshot = input.overallConfidence == null
    ? baseSnapshot
    : { ...baseSnapshot, quality: { ...baseSnapshot.quality, overallConfidence: input.overallConfidence } };
  return buildDraftContextV2({
    snapshot,
    artifact: {
      contentHash: canonicalSha256(snapshot),
      capturedAt: input.capturedAt || '2026-08-20T12:00:00.000Z',
    },
    seller: normalizeDraftSellerProfileV2({
      name: 'Grace Hopper',
      companyName: 'Northstar',
      services: ['Automatización de operaciones'],
    }),
    style: createDefaultDraftWritingStyleV2(),
    now: DRAFT_FIXTURE_NOW,
  });
}

test('DraftContextV2 separates source-backed evidence from hypotheses and carries quality constraints', () => {
  const result = build();

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.context.schemaVersion, 'draft-context/v2');
  assert.equal(result.context.company.name, 'Acme');
  assert.equal(result.context.person.fullName, 'Ada Lovelace');
  assert.equal(result.context.research.fresh, true);
  assert.ok(result.context.evidence.every((evidence) => evidence.source.url.startsWith('https://')));
  assert.ok(result.context.evidence.some((evidence) => evidence.supportedFactClaimIds.includes('claim-acme-overview')));
  assert.deepEqual(result.context.hypotheses.map((hypothesis) => hypothesis.claimId), ['claim-acme-opportunity']);
  assert.equal(result.context.quality.minimumScore, MIN_DRAFT_QUALITY_SCORE);
  assert.equal(result.context.quality.priority, 'B');
  assert.equal(result.context.constraints.cta.maximumCount, 1);
});

test('DraftContextV2 blocks research below the drafting quality threshold without manufacturing copy', () => {
  const result = build({ includeRole: false, overallConfidence: 0.2 });

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.reason, 'quality_below_threshold');
  assert.ok(result.context.quality.score < MIN_DRAFT_QUALITY_SCORE);
  assert.equal(result.context.evidence.length > 0, true);
});

test('DraftContextV2 rejects stale research artifacts even when old evidence remains structurally valid', () => {
  const result = build({ capturedAt: '2026-07-01T12:00:00.000Z' });

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.reason, 'research_stale');
  assert.equal(result.context.research.fresh, false);
});

test('DraftContextV2 represents insufficient evidence as a blocked result instead of a draftable fallback', () => {
  const snapshot = draftSnapshotFixture();
  const insufficientSnapshot = {
    ...snapshot,
    lifecycle: { ...snapshot.lifecycle, status: 'insufficient_data' as const },
  };
  const result = buildDraftContextV2({
    snapshot: insufficientSnapshot,
    artifact: { contentHash: canonicalSha256(insufficientSnapshot), capturedAt: '2026-08-20T12:00:00.000Z' },
    seller: normalizeDraftSellerProfileV2({ companyName: 'Northstar' }),
    style: createDefaultDraftWritingStyleV2(),
    now: DRAFT_FIXTURE_NOW,
  });

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.reason, 'evidence_insufficient');
});

test('DraftContextV2 blocks a snapshot whose persisted artifact hash does not match', () => {
  const snapshot = draftSnapshotFixture();
  const result = buildDraftContextV2({
    snapshot,
    artifact: { contentHash: 'a'.repeat(64), capturedAt: '2026-08-20T12:00:00.000Z' },
    seller: normalizeDraftSellerProfileV2({ companyName: 'Northstar' }),
    style: createDefaultDraftWritingStyleV2(),
    now: DRAFT_FIXTURE_NOW,
  });

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.reason, 'research_artifact_invalid');
});
