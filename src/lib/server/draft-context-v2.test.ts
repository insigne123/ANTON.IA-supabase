import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_DRAFT_QUALITY_SCORE,
  buildDraftContextV2,
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
  requiredReportAwareDraftPersonalizationV2,
  type DraftReportDocumentMetadataV2,
} from './draft-context-v2';
import { validateDraftPreflightV2 } from './draft-preflight-v2';
import {
  DRAFT_FIXTURE_NOW,
  draftReportV2Fixture,
  draftSnapshotFixture,
} from './draft-v2-test-fixtures';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { buildDeterministicResearchReportDocumentV1 } from '@/ai/flows/synthesize-research-report';
import { ResearchReportDocumentV1Schema, type ResearchReportDocumentV1 } from '@/lib/research-report-contracts';
import type { ReportV2 } from '@/lib/report-v2-contracts';
import type { ResearchSnapshotV1 } from '@/lib/research-contracts';

function build(input: {
  includeRole?: boolean;
  capturedAt?: string;
  overallConfidence?: number;
  snapshot?: ResearchSnapshotV1;
  contentHash?: string;
  reportDocument?: ResearchReportDocumentV1 | ReportV2;
  reportDocumentMetadata?: DraftReportDocumentMetadataV2;
} = {}) {
  const baseSnapshot = input.snapshot || draftSnapshotFixture({ includeRole: input.includeRole });
  const snapshot = input.overallConfidence == null
    ? baseSnapshot
    : { ...baseSnapshot, quality: { ...baseSnapshot.quality, overallConfidence: input.overallConfidence } };
  return buildDraftContextV2({
    snapshot,
    artifact: {
      contentHash: input.contentHash || canonicalSha256(snapshot),
      capturedAt: input.capturedAt || '2026-08-20T12:00:00.000Z',
    },
    seller: normalizeDraftSellerProfileV2({
      name: 'Grace Hopper',
      companyName: 'Northstar',
      services: ['Automatización de operaciones'],
    }),
    style: createDefaultDraftWritingStyleV2(),
    reportDocument: input.reportDocument,
    reportDocumentMetadata: input.reportDocumentMetadata,
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
  assert.equal(result.context.quality.priority, 'A');
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

test('DraftContextV2 blocks drafting until the seller declares services or a value proposition', () => {
  const snapshot = draftSnapshotFixture();
  const result = buildDraftContextV2({
    snapshot,
    artifact: { contentHash: canonicalSha256(snapshot), capturedAt: '2026-08-20T12:00:00.000Z' },
    seller: normalizeDraftSellerProfileV2({ companyName: 'Northstar', description: 'Empresa de tecnología.' }),
    style: createDefaultDraftWritingStyleV2(),
    now: DRAFT_FIXTURE_NOW,
  });

  assert.equal(result.status, 'blocked');
  if (result.status !== 'blocked') return;
  assert.equal(result.reason, 'seller_profile_incomplete');
  assert.match(result.message, /Productos y servicios|Propuesta de valor/);
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

test('DraftContextV2 bounds deep-crawl evidence without dropping factual drafting anchors', () => {
  const base = draftSnapshotFixture();
  const extraEvidence = Array.from({ length: 60 }, (_, index) => ({
    ...structuredClone(base.evidence[0]),
    id: `evidence-deep-${index}`,
    statement: `Acme documenta el proceso operativo verificable ${index + 1}.`,
    confidence: 0.7 + (index % 10) / 100,
  }));
  const template = base.claims.find((claim) => claim.id === 'claim-acme-overview')!;
  const snapshot = {
    ...structuredClone(base),
    evidence: [...base.evidence, ...extraEvidence],
    claims: [...base.claims, ...extraEvidence.map((evidence, index) => ({
      ...structuredClone(template),
      id: `claim-deep-${index}`,
      statement: evidence.statement,
      supportingEvidenceIds: [evidence.id],
    }))],
  };
  const result = buildDraftContextV2({
    snapshot,
    artifact: { contentHash: canonicalSha256(snapshot), capturedAt: '2026-08-20T12:00:00.000Z' },
    seller: normalizeDraftSellerProfileV2({ companyName: 'Northstar', services: ['Automatización de operaciones'] }),
    style: createDefaultDraftWritingStyleV2(),
    now: DRAFT_FIXTURE_NOW,
  });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.equal(result.context.evidence.length, 50);
  assert.ok(result.context.evidence.every((evidence) => evidence.supportedFactClaimIds.length > 0));
});

test('company evidence takes priority over a formal person role in draft personalization', () => {
  const snapshot = draftSnapshotFixture();
  const deterministic = buildDeterministicResearchReportDocumentV1({
    snapshot,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const personAnchor = deterministic.outreachBrief.factualAnchors.find((anchor) =>
    anchor.citations.claimIds.includes('claim-ada-role'),
  );
  assert.ok(personAnchor);
  const reportDocument = ResearchReportDocumentV1Schema.parse({
    ...deterministic,
    outreachBrief: {
      ...deterministic.outreachBrief,
      factualAnchors: [personAnchor],
    },
  });

  const result = build({ reportDocument });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(result.context.report?.outreachBrief.selectedFactualAnchorClaimIds, ['claim-ada-role']);
  assert.deepEqual(result.context.report?.outreachBrief.selectedHypothesisIds, ['claim-acme-opportunity']);
  assert.equal(result.context.report?.synthesis.method, 'fallback');
  assert.equal(requiredReportAwareDraftPersonalizationV2(result.context)[0].claimId, 'claim-acme-overview');
});

test('DraftContextV2 maps Report V2 short claims to canonical snapshot claims and pins exact provenance', () => {
  const reportDocument = draftReportV2Fixture();
  const metadata = {
    id: 'persisted-report-row-id',
    schemaVersion: reportDocument.schemaVersion,
    revision: reportDocument.revision,
    contentHash: canonicalSha256(reportDocument),
  } satisfies DraftReportDocumentMetadataV2;
  const result = build({ reportDocument, reportDocumentMetadata: metadata });

  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') return;
  assert.deepEqual(result.context.report?.document, metadata);
  assert.deepEqual(result.context.report?.outreachBrief.selectedFactualAnchorClaimIds, ['claim-acme-overview']);
  assert.equal(result.context.report?.synthesis.method, 'model');
  assert.deepEqual(result.context.evidence, build().context.evidence);
});

function reportOwnedFixture() {
  const report = draftReportV2Fixture();
  const source = report.evidenceGraph.sources[0];
  source.url = source.canonicalUrl = 'https://acme.example/operaciones';
  const fact = report.evidenceGraph.facts[0];
  fact.text = 'Acme centraliza solicitudes de operaciones en un portal para sus clientes.';
  fact.observedAt = null;
  fact.jurisdiction = null;
  const claim = report.evidenceGraph.claims[0];
  claim.internalId = 'f_cccccccccc';
  claim.scope = 'company';
  claim.statement = fact.text;
  claim.observedAt = null;
  claim.freshnessDays = null;
  report.evidenceGraph.shortIdMap.c01 = claim.internalId;
  const paragraph = report.sections.find((section) => section.key === 'angle')!.paragraphs[0];
  paragraph.text = claim.statement;
  paragraph.basis = 'source';
  return report;
}

test('Report V2 owned facts retain exact report provenance without manufacturing snapshot links', () => {
  const snapshot = draftSnapshotFixture();
  const reportDocument = reportOwnedFixture();
  const originalSnapshot = structuredClone(snapshot);
  const originalReport = structuredClone(reportDocument);
  const contentHash = canonicalSha256(reportDocument);
  const metadata: DraftReportDocumentMetadataV2 = {
    id: 'persisted-report-row-id',
    schemaVersion: reportDocument.schemaVersion,
    revision: reportDocument.revision,
    contentHash,
  };
  const result = build({ snapshot, reportDocument, reportDocumentMetadata: metadata });

  assert.equal(result.status, 'ready');
  const evidence = result.context.evidence.find((item) => item.provenance)!;
  assert.ok(evidence);
  assert.deepEqual(evidence.provenance, {
    kind: 'report_v2',
    documentId: metadata.id,
    revision: metadata.revision,
    contentHash,
    claimId: 'c01',
    factId: 'f_bbbbbbbbbb',
    sourceId: 'src_aaaaaaaaaa',
    sourceContentHash: reportDocument.evidenceGraph.sources[0].contentHash,
  });
  assert.equal(evidence.statement, reportDocument.evidenceGraph.facts[0].text);
  assert.equal(evidence.source.url, reportDocument.evidenceGraph.sources[0].url);
  assert.equal(evidence.source.reliability, 0);
  assert.equal(evidence.confidence, reportDocument.evidenceGraph.claims[0].confidence);
  assert.deepEqual(result.context.report?.document, metadata);
  assert.deepEqual(result.context.report?.outreachBrief.selectedFactualAnchorClaimIds, evidence.supportedFactClaimIds);
  assert.deepEqual(requiredReportAwareDraftPersonalizationV2(result.context), [{
    evidenceId: evidence.evidenceId,
    claimId: evidence.supportedFactClaimIds[0],
    sourceUrl: evidence.source.url,
  }]);
  assert.ok(!snapshot.claims.some((claim) => evidence.supportedFactClaimIds.includes(claim.id)));
  assert.ok(!snapshot.evidence.some((item) => item.id === evidence.evidenceId));
  assert.ok(!snapshot.sources.some((source) => source.id === evidence.source.sourceId));
  assert.equal(result.context.research.contentHash, canonicalSha256(snapshot));
  assert.deepEqual(result.context.quality, build({ snapshot }).context.quality);
  assert.deepEqual(result.context.constraints, build({ snapshot }).context.constraints);
  assert.deepEqual(snapshot, originalSnapshot);
  assert.deepEqual(reportDocument, originalReport);
  assert.deepEqual(build({ snapshot, reportDocument, reportDocumentMetadata: metadata }), result);

  const revised = structuredClone(reportDocument);
  revised.revision += 1;
  const revisedEvidence = build({ reportDocument: revised }).context.evidence.find((item) => item.provenance)!;
  assert.notEqual(revisedEvidence.evidenceId, evidence.evidenceId);
  assert.notEqual(revisedEvidence.supportedFactClaimIds[0], evidence.supportedFactClaimIds[0]);
});

test('report-owned anchors pass unchanged preflight and reject fabricated IDs or source URLs', () => {
  const reportDocument = reportOwnedFixture();
  const { context } = build({ reportDocument });
  const personalization = requiredReportAwareDraftPersonalizationV2(context);
  const output = {
    subject: 'Operaciones en Acme',
    body: `Hola Ada,

${reportDocument.evidenceGraph.facts[0].text}

En Northstar automatizamos tareas repetitivas para reducir trabajo manual y dejar la informacion disponible para el equipo.

${context.constraints.cta.exactText}`,
    personalization,
    hypothesisIds: [],
  };
  const checked = validateDraftPreflightV2(context, output, { now: DRAFT_FIXTURE_NOW });
  assert.equal(checked.valid, true, JSON.stringify(checked.issues));
  for (const replacement of [
    { claimId: 'claim-acme-overview' },
    { claimId: 'f_cccccccccc' },
    { evidenceId: 'evidence-acme' },
    { sourceUrl: 'https://unrelated.example/' },
  ]) {
    const invalid = validateDraftPreflightV2(context, {
      ...output,
      personalization: [{ ...personalization[0], ...replacement }],
    }, { now: DRAFT_FIXTURE_NOW });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.issues.some((issue) => ['personalization_invalid', 'source_url_invalid'].includes(issue.code)));
  }
});

test('report-owned claims do not require a snapshot-style internal ID', () => {
  const reportDocument = reportOwnedFixture();
  reportDocument.evidenceGraph.claims[0].internalId = null;
  reportDocument.evidenceGraph.shortIdMap.c01 = null;
  const { context } = build({ reportDocument });
  assert.equal(context.report?.outreachBrief.selectedFactualAnchorClaimIds.length, 1);
  assert.equal(context.evidence.find((item) => item.provenance)?.provenance?.claimId, 'c01');
});

test('a recommendation can select its cited source fact without turning its prose into evidence', () => {
  const reportDocument = reportOwnedFixture();
  const paragraph = reportDocument.sections.find((section) => section.key === 'angle')!.paragraphs[0];
  paragraph.basis = 'recommendation';
  paragraph.text = 'Proponer un piloto para ahorrar cien horas mensuales.';
  const { context } = build({ reportDocument });
  const evidence = context.evidence.find((item) => item.provenance)!;
  assert.ok(evidence);
  assert.equal(evidence.statement, reportDocument.evidenceGraph.facts[0].text);
  assert.deepEqual(context.report?.outreachBrief.selectedFactualAnchorClaimIds, evidence.supportedFactClaimIds);
  assert.ok(!context.evidence.some((item) => item.statement === paragraph.text));
});

test('unsupported report anchors preserve the original snapshot factual fallback', async (t) => {
  const mutations: Array<[string, (report: ReportV2) => void]> = [
    ['material audit warning', (report) => { report.audit.status = 'warning'; report.audit.issues = [{ section: 'angle', paragraphIndex: 0, type: 'invalid_citation', severity: 'warn', fragment: 'Evidence needs review.' }]; }],
    ['foreign entity', (report) => { report.entity.companyDomain = 'other.example'; }],
    ['stale report', (report) => { report.synthesis.generatedAt = '2026-07-01T12:00:00.000Z'; }],
    ['expired public company artifact', (report) => { report.publicCompanyResearch = { artifactId: '00000000-0000-4000-8000-000000000001', revision: 1, expiresAt: DRAFT_FIXTURE_NOW.toISOString() }; }],
    ['stale source', (report) => { report.evidenceGraph.sources[0].retrievedAt = '2026-07-01T12:00:00.000Z'; }],
    ['future source', (report) => { report.evidenceGraph.sources[0].retrievedAt = '2026-09-01T12:00:00.000Z'; }],
    ['stale claim', (report) => { report.evidenceGraph.claims[0].observedAt = '2026-07-01T12:00:00.000Z'; }],
    ['stale fact', (report) => { report.evidenceGraph.facts[0].observedAt = '2026-07-01T12:00:00.000Z'; }],
    ['undated signal', (report) => { report.evidenceGraph.claims[0].dimension = 'signal'; }],
    ['group scope', (report) => { report.evidenceGraph.claims[0].scope = 'group'; }],
    ['other country scope', (report) => { report.evidenceGraph.claims[0].scope = 'country'; report.evidenceGraph.claims[0].jurisdiction = 'CO'; }],
    ['sector scope', (report) => { report.evidenceGraph.claims[0].scope = 'sector'; }],
    ['unknown scope', (report) => { delete report.evidenceGraph.claims[0].scope; }],
    ['foreign claim', (report) => { report.evidenceGraph.claims[0].jurisdiction = 'CL'; }],
    ['foreign fact', (report) => { report.evidenceGraph.facts[0].jurisdiction = 'CL'; }],
    ['foreign source', (report) => { report.evidenceGraph.sources[0].jurisdiction = 'CL'; }],
    ['unsupported authority', (report) => { report.evidenceGraph.claims[0].dimension = 'contact_authority'; }],
    ['unrelated claim', (report) => { report.evidenceGraph.claims[0].statement = 'Otra empresa centraliza solicitudes de operaciones.'; }],
    ['non-http source', (report) => { report.evidenceGraph.sources[0].url = 'ftp://acme.example/about'; }],
    ['non-http canonical source', (report) => { report.evidenceGraph.sources[0].canonicalUrl = 'ftp://acme.example/about'; }],
    ['challenge page', (report) => { report.evidenceGraph.sources[0].url = 'https://acme.example/cdn-cgi/challenge-platform/check'; }],
    ['search source', (report) => { report.evidenceGraph.sources[0].sourceType = 'search'; }],
    ['registry source', (report) => { report.evidenceGraph.sources[0].sourceType = 'registry'; }],
    ['source noise', (report) => { report.evidenceGraph.facts[0].text = 'Please wait while your request is being verified'; }],
    ['unrelated source', (report) => {
      const source = report.evidenceGraph.sources[0];
      source.title = 'Other company';
      source.url = source.canonicalUrl = 'https://unrelated.example/';
    }],
    ['hypothesis', (report) => {
      report.evidenceGraph.claims[0] = { ...report.evidenceGraph.claims[0], type: 'hypothesis', validationQuestion: 'Is this confirmed?' };
    }],
    ['declared profile', (report) => {
      report.evidenceGraph.claims[0] = { ...report.evidenceGraph.claims[0], type: 'declared', evidenceIds: [] };
    }],
    ['derived estimate', (report) => {
      report.evidenceGraph.claims[0] = {
        ...report.evidenceGraph.claims[0], type: 'derived', inputs: ['c01'], formula: 'input * assumption',
        assumptions: [{ id: 'asm_aaaaaaaaaa', label: 'Estimate', value: 2, rationale: 'Assumed multiplier', editable: true }],
      };
    }],
    ...(['profile', 'analysis', 'recommendation'] as const).map((basis): [string, (report: ReportV2) => void] => [
      `${basis}-only paragraph`, (report) => {
        const paragraph = report.sections.find((section) => section.key === 'angle')!.paragraphs[0];
        paragraph.basis = basis;
        paragraph.claimIds = [];
      },
    ]),
    ['headquarters paragraph', (report) => { report.sections.find((section) => section.key === 'angle')!.paragraphs[0].context = 'headquarters'; }],
  ];
  const fallback = build().context;
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const reportDocument = reportOwnedFixture();
      mutate(reportDocument);
      const result = build({ reportDocument });
      assert.equal(result.status, 'ready');
      assert.deepEqual(result.context.report?.outreachBrief.selectedFactualAnchorClaimIds, []);
      assert.deepEqual(result.context.evidence, fallback.evidence);
      assert.deepEqual(result.context.hypotheses, fallback.hypotheses);
      assert.deepEqual(requiredReportAwareDraftPersonalizationV2(result.context), requiredReportAwareDraftPersonalizationV2(fallback));
    });
  }
});

test('report-owned person facts cannot outrank company facts or verify a different person', () => {
  const reportDocument = reportOwnedFixture();
  const claim = reportDocument.evidenceGraph.claims[0];
  claim.scope = 'person';
  claim.dimension = 'contact_role';
  claim.statement = 'Ada Lovelace dirige el equipo de operaciones de Acme.';
  reportDocument.evidenceGraph.facts[0].text = claim.statement;
  const { context } = build({ reportDocument });
  assert.equal(context.evidence.find((item) => item.provenance)?.subjectScope, 'person');
  assert.equal(requiredReportAwareDraftPersonalizationV2(context)[0].claimId, 'claim-acme-overview');
  reportDocument.evidenceGraph.facts[0].text = 'Grace Hopper dirige operaciones de otra empresa.';
  assert.deepEqual(build({ reportDocument }).context.report?.outreachBrief.selectedFactualAnchorClaimIds, []);
});

test('large report graphs remain bounded without removing snapshot fallback facts', () => {
  const reportDocument = reportOwnedFixture();
  const fact = reportDocument.evidenceGraph.facts[0];
  reportDocument.evidenceGraph.facts = Array.from({ length: 60 }, (_, index) => ({
    ...fact,
    id: `f_${index.toString(16).padStart(10, '0')}`,
  }));
  reportDocument.evidenceGraph.claims[0].evidenceIds = reportDocument.evidenceGraph.facts.map((item) => item.id);
  reportDocument.sections.find((section) => section.key === 'angle')!.paragraphs.push({
    text: 'The same factual anchor is also cited here.', claimIds: ['c01'], context: 'target', basis: 'source',
  });
  const { context } = build({ reportDocument });
  assert.equal(context.evidence.filter((item) => item.provenance).length, 20);
  assert.ok(context.evidence.length <= 50);
  assert.equal(new Set(context.evidence.map((item) => item.evidenceId)).size, context.evidence.length);
  assert.ok(context.evidence.some((item) => item.supportedFactClaimIds.includes('claim-acme-overview')));
  assert.equal(context.report?.outreachBrief.selectedFactualAnchorClaimIds.length, 1);
});

test('report-owned facts cannot bypass snapshot artifact, lifecycle or quality guards', () => {
  const reportDocument = reportOwnedFixture();
  const insufficient = draftSnapshotFixture();
  insufficient.lifecycle.status = 'insufficient_data';
  const cases = [
    { input: { contentHash: 'f'.repeat(64) }, reason: 'research_artifact_invalid' },
    { input: { capturedAt: '2026-07-01T12:00:00.000Z' }, reason: 'research_stale' },
    { input: { snapshot: insufficient }, reason: 'evidence_insufficient' },
    { input: { includeRole: false, overallConfidence: 0.2 }, reason: 'quality_below_threshold' },
  ];
  for (const { input, reason } of cases) {
    const result = build({ ...input, reportDocument });
    assert.equal(result.status, 'blocked');
    if (result.status === 'blocked') assert.equal(result.reason, reason);
  }
});

test('snapshot-mapped claims cannot escape expiry or contradiction guards via the report-owned path', () => {
  for (const reason of ['expired', 'contradicted']) {
    const snapshot = draftSnapshotFixture();
    const claim = snapshot.claims.find((item) => item.id === 'claim-acme-overview')!;
    if (reason === 'expired') claim.freshness.validUntil = '2026-07-01T12:00:00.000Z';
    else snapshot.contradictions.push({
      id: 'contradiction-acme', claimIds: [claim.id], evidenceIds: claim.supportingEvidenceIds,
      summary: 'The company fact needs review.', status: 'unresolved',
    });
    const { context } = build({ snapshot, reportDocument: draftReportV2Fixture() });
    assert.deepEqual(context.report?.outreachBrief.selectedFactualAnchorClaimIds, []);
    assert.ok(!context.evidence.some((item) => item.provenance));
  }
});

test('Report V2 scope, graph integrity and blocking audit failures still reject draft context', () => {
  for (const key of ['organizationId', 'ownerUserId'] as const) {
    const reportDocument = reportOwnedFixture();
    reportDocument.scope[key] = 'another-scope';
    assert.throws(() => build({ reportDocument }), /RESEARCH_REPORT_V2_DOCUMENT_SCOPE_MISMATCH/);
  }
  const wrongSnapshot = reportOwnedFixture();
  wrongSnapshot.researchSnapshotId = 'another-snapshot';
  assert.throws(() => build({ reportDocument: wrongSnapshot }), /RESEARCH_REPORT_V2_DOCUMENT_SCOPE_MISMATCH/);
  const blocking = reportOwnedFixture();
  blocking.audit.issues.push({ section: 'angle', paragraphIndex: 0, type: 'hard_hypothesis', fragment: 'Unsupported assertion', severity: 'block' });
  assert.throws(() => build({ reportDocument: blocking }), /audit_has_blocking_issues/);
  const dangling = reportOwnedFixture();
  dangling.evidenceGraph.facts = [];
  assert.throws(() => build({ reportDocument: dangling }), /claim_evidence_missing/);
  const missingSource = reportOwnedFixture();
  missingSource.evidenceGraph.sources = [];
  assert.throws(() => build({ reportDocument: missingSource }), /fact_source_missing/);
});

test('DraftContextV2 rejects Report V2 provenance that does not match the supplied document', () => {
  const reportDocument = draftReportV2Fixture();
  assert.throws(
    () => build({
      reportDocument,
      reportDocumentMetadata: {
        id: 'persisted-report-row-id',
        schemaVersion: reportDocument.schemaVersion,
        revision: reportDocument.revision,
        contentHash: 'f'.repeat(64),
      },
    }),
    /RESEARCH_REPORT_DOCUMENT_METADATA_MISMATCH/,
  );
});

test('dangling report references are rejected before they can enter DraftContextV2', () => {
  const snapshot = draftSnapshotFixture();
  const deterministic = buildDeterministicResearchReportDocumentV1({
    snapshot,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const firstAnchor = deterministic.outreachBrief.factualAnchors[0];
  const dangling = {
    ...deterministic,
    outreachBrief: {
      ...deterministic.outreachBrief,
      factualAnchors: [{
        ...firstAnchor,
        citations: { ...firstAnchor.citations, claimIds: ['claim-does-not-exist'] },
      }],
    },
  } as ResearchReportDocumentV1;

  assert.throws(
    () => build({ reportDocument: dangling }),
    /references unknown claim claim-does-not-exist/,
  );
});
