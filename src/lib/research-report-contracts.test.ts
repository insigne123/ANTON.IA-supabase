import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDeterministicResearchReportDocumentV1 } from '@/ai/flows/synthesize-research-report';
import {
  ResearchReportCitationError,
  ResearchReportDocumentV1Schema,
  validateResearchReportDocumentCitationsV1,
} from '@/lib/research-report-contracts';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';

const generatedAt = '2026-08-24T18:00:00.000Z';

test('report contract rejects uncited factual blocks and unknown canonical references', () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const uncited = structuredClone(document) as any;
  delete uncited.executiveSummary.facts[0].citations;
  assert.equal(ResearchReportDocumentV1Schema.safeParse(uncited).success, false);

  const unknownClaim = structuredClone(document) as any;
  unknownClaim.executiveSummary.facts[0].citations.claimIds = ['claim-does-not-exist'];
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(unknownClaim, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /unknown claim claim-does-not-exist/.test(error.message),
  );

  const danglingEvidence = structuredClone(document) as any;
  danglingEvidence.executiveSummary.facts[0].citations.evidenceIds = ['evidence-does-not-exist'];
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(danglingEvidence, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /unknown evidence evidence-does-not-exist/.test(error.message),
  );
});

test('report contract keeps hypotheses labeled and rejects fact citations for them', () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  assert.ok(document.commercialHypotheses.length > 0);
  assert.equal(document.commercialHypotheses[0].classification, 'hypothesis');

  const invalid = structuredClone(document) as any;
  invalid.commercialHypotheses[0].citations = {
    claimIds: ['claim-acme-overview'],
    evidenceIds: ['evidence-acme'],
  };
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(invalid, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /as hypothesis/.test(error.message),
  );
});

test('report contract rejects invented and paraphrased canonical statements', () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const inventedFact = structuredClone(document) as any;
  inventedFact.executiveSummary.facts[0].statement = 'Acme duplicó sus ingresos durante el último año.';
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(inventedFact, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /statement does not match/.test(error.message),
  );

  const paraphrasedHypothesis = structuredClone(document) as any;
  paraphrasedHypothesis.commercialHypotheses[0].statement = 'Quizás Acme quiera acelerar sus operaciones.';
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(paraphrasedHypothesis, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /statement does not match/.test(error.message),
  );
});

test('report narrative may paraphrase cited claims but cannot detach them from canonical evidence', () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const readable = structuredClone(document) as any;
  readable.narrative.executiveSummary[0].text = 'Acme presenta una propuesta enfocada en reducir trabajo manual dentro de operaciones.';
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(readable, snapshot));

  const unsupported = structuredClone(readable) as any;
  unsupported.narrative.executiveSummary[0].evidenceIds = ['evidence-ada'];
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(unsupported, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /does not support a cited claim/.test(error.message),
  );

  const wrongSection = structuredClone(readable) as any;
  wrongSection.narrative.companyProfile[0].claimIds = ['claim-ada-role'];
  wrongSection.narrative.companyProfile[0].evidenceIds = ['evidence-ada'];
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(wrongSection, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /wrong narrative section/.test(error.message),
  );
});

test('report documents created before narrative v2 remain readable', () => {
  const snapshot = draftSnapshotFixture();
  const historical = structuredClone(buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt })) as any;
  delete historical.narrative;
  assert.equal(ResearchReportDocumentV1Schema.safeParse(historical).success, true);
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(historical, snapshot));
});

test('report contract derives signal metadata from the cited canonical chain and fallback validates', () => {
  const raw = structuredClone(draftSnapshotFixture()) as any;
  raw.sources.push({
    id: 'source-news',
    type: 'news',
    url: 'https://news.example/acme-expansion',
    canonicalUrl: 'https://news.example/acme-expansion',
    title: 'Acme anuncia expansión',
    provider: 'fixture',
    publishedAt: '2026-08-21T10:00:00.000Z',
    retrievedAt: '2026-08-22T10:00:00.000Z',
    reliability: 0.8,
  });
  raw.evidence.push({
    id: 'evidence-news',
    subjectScope: 'company',
    kind: 'event',
    path: 'fixture.news',
    statement: 'Acme anunció la apertura de una nueva operación regional.',
    sourceId: 'source-news',
    observedAt: '2026-08-21T09:00:00.000Z',
    extractedAt: '2026-08-22T10:00:00.000Z',
    confidence: 0.8,
    extraction: { method: 'rule', provider: 'fixture', version: 'fixture/v1' },
  });
  raw.claims.push({
    id: 'claim-news',
    kind: 'news_signal',
    subjectScope: 'company',
    classification: 'fact',
    statement: 'Acme anunció la apertura de una nueva operación regional.',
    supportingEvidenceIds: ['evidence-news'],
    contradictingEvidenceIds: [],
    confidence: 0.8,
    freshness: {
      asOf: '2026-08-21T09:00:00.000Z',
      validUntil: '2026-09-21T09:00:00.000Z',
      policyVersion: 'research-freshness/v1',
    },
    derivation: { method: 'rule', promptVersion: 'fixture/v1' },
  });
  const snapshot = ResearchSnapshotV1Schema.parse(raw);
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });

  assert.equal(document.signals[0].signalType, 'news');
  assert.equal(document.signals[0].observedAt, '2026-08-21T09:00:00.000Z');
  assert.doesNotThrow(() => validateResearchReportDocumentCitationsV1(document, snapshot));

  const wrongType = structuredClone(document) as any;
  wrongType.signals[0].signalType = 'hiring';
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(wrongType, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /signalType/.test(error.message),
  );

  const wrongDate = structuredClone(document) as any;
  wrongDate.signals[0].observedAt = '2026-08-20T09:00:00.000Z';
  assert.throws(
    () => validateResearchReportDocumentCitationsV1(wrongDate, snapshot),
    (error: any) => error instanceof ResearchReportCitationError && /observedAt/.test(error.message),
  );
});

test('report contradiction summary and status must remain canonical', () => {
  const raw = structuredClone(draftSnapshotFixture()) as any;
  raw.contradictions = [{
    id: 'contradiction-acme',
    claimIds: ['claim-acme-overview'],
    evidenceIds: ['evidence-acme'],
    summary: 'La descripción pública de Acme requiere revisión.',
    status: 'unresolved',
  }];
  const snapshot = ResearchSnapshotV1Schema.parse(raw);
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const wrong = structuredClone(document) as any;
  wrong.contradictions[0].summary = 'La contradicción ya no es relevante.';
  wrong.contradictions[0].status = 'resolved';

  assert.throws(
    () => validateResearchReportDocumentCitationsV1(wrong, snapshot),
    (error: any) => error instanceof ResearchReportCitationError
      && /summary does not match/.test(error.message)
      && /status does not match/.test(error.message),
  );
});
