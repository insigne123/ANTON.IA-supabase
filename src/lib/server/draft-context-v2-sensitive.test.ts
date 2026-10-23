import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { buildDraftContextV2, createDefaultDraftWritingStyleV2, normalizeDraftSellerProfileV2 } from './draft-context-v2';
import { DRAFT_FIXTURE_NOW, draftSnapshotFixture } from './draft-v2-test-fixtures';

const CAPTURED_AT = '2026-08-20T12:00:00.000Z';
const VALID_UNTIL = '2026-09-20T12:00:00.000Z';

function withCompanyFact(id: string, statement: string) {
  return {
    evidence: { id: `evidence-${id}`, subjectScope: 'company' as const, kind: 'fact' as const, path: 'fixture.company', statement, sourceId: 'source-acme', extractedAt: CAPTURED_AT, confidence: 0.9, extraction: { method: 'rule' as const, provider: 'fixture', version: 'fixture/v1' } },
    claim: { id: `claim-${id}`, kind: 'company_overview' as const, subjectScope: 'company' as const, classification: 'fact' as const, statement, supportingEvidenceIds: [`evidence-${id}`], contradictingEvidenceIds: [], confidence: 0.86,
      freshness: { asOf: CAPTURED_AT, validUntil: VALID_UNTIL, policyVersion: 'research-freshness/v1' as const }, derivation: { method: 'rule' as const, promptVersion: 'fixture/v1' } },
  };
}

test('a death or a disaster at the company stays in the research but is not offered to the writer as evidence', () => {
  const plant = withCompanyFact('plant', 'Acme abrió una planta nueva en Arequipa con 200 puestos de trabajo para operaciones.');
  const accident = withCompanyFact('accident', 'Acme informó con profundo pesar el fallecimiento de dos trabajadores contratistas en su faena de Arequipa.');
  const base = draftSnapshotFixture();
  const snapshot = ResearchSnapshotV1Schema.parse({
    ...base, evidence: [...base.evidence, plant.evidence, accident.evidence], claims: [...base.claims, plant.claim, accident.claim],
  });
  const result = buildDraftContextV2({
    snapshot, artifact: { contentHash: canonicalSha256(snapshot), capturedAt: CAPTURED_AT },
    seller: normalizeDraftSellerProfileV2({ name: 'Grace Hopper', companyName: 'Northstar', services: ['Automatización de operaciones'] }),
    style: createDefaultDraftWritingStyleV2(), now: DRAFT_FIXTURE_NOW,
  });
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  const statements = result.context.evidence.map((item) => item.statement);
  assert.ok(statements.includes(plant.evidence.statement), 'an ordinary new fact is offered');
  assert.ok(!statements.some((statement) => /fallecimiento/.test(statement)), statements.join(' | '));
  assert.ok(!result.context.evidence.some((item) => item.supportedFactClaimIds.includes('claim-accident')));
  // The research keeps it: whoever sells should know about it, and be careful.
  assert.ok(snapshot.claims.some((claim) => claim.id === 'claim-accident'));
});
