import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import type { ReportV2 } from '@/lib/report-v2-contracts';
import {
  buildDraftContextV2, createDefaultDraftWritingStyleV2, draftSignalEvidenceEnabled, normalizeDraftSellerProfileV2, requiredReportAwareDraftPersonalizationV2,
} from './draft-context-v2';
import { DRAFT_FIXTURE_NOW, draftReportV2Fixture, draftSnapshotFixture } from './draft-v2-test-fixtures';

const SIGNAL_STATEMENT = 'Acme publicó 10 vacantes de auxiliar de bodega en Lima y busca 5 operarios de planta en Arequipa.';

/** The fixture of the report plus a dated signal that the analysis chose and the angle does not cite, with two facts of a third-party page. */
function reportWithSignal(overrides: { statement?: string; observedAt?: string; auditIssue?: ReportV2['audit']['issues'][number] } = {}) {
  const report = draftReportV2Fixture();
  // The generic claim the angle cites, as a report owns it (company scope, no date).
  report.evidenceGraph.sources[0]!.url = report.evidenceGraph.sources[0]!.canonicalUrl = 'https://acme.example/operaciones';
  const overview = report.evidenceGraph.facts[0]!;
  overview.observedAt = null;
  overview.jurisdiction = null;
  const generic = report.evidenceGraph.claims[0]!;
  generic.internalId = 'f_cccccccccc';
  generic.scope = 'company';
  generic.observedAt = null;
  generic.freshnessDays = null;
  report.evidenceGraph.shortIdMap.c01 = generic.internalId;
  report.sections.find((section) => section.key === 'angle')!.paragraphs[0]!.basis = 'source';
  report.evidenceGraph.sources.push({
    id: 'src_cccccccccc', url: 'https://empleos.example/acme-busca-trabajadores', canonicalUrl: 'https://empleos.example/acme-busca-trabajadores', title: 'Acme busca trabajadores',
    sourceType: 'other', jurisdiction: 'PE', publishedAt: '2026-08-15T00:00:00.000Z', modifiedAt: null, retrievedAt: '2026-08-20T12:00:00.000Z', ownDomain: false, contentHash: 'c'.repeat(64),
  });
  report.evidenceGraph.facts.push(
    { id: 'f_dddddddddd', sourceId: 'src_cccccccccc', text: 'Así se verá:Acme publicó el aviso Auxiliar de Bodega. Vacantes publicadas: 10. Ubicación: Lima.', observedAt: null, jurisdiction: null, locator: 'block:1' },
    { id: 'f_eeeeeeeeee', sourceId: 'src_cccccccccc', text: 'Acme busca 5 operarios de planta en Arequipa, con postulación hasta el 30 de agosto.', observedAt: null, jurisdiction: null, locator: 'block:2' },
  );
  report.evidenceGraph.claims.push({
    id: 'c02', internalId: 'f_ffffffffff', type: 'fact', dimension: 'signal', statement: overrides.statement ?? SIGNAL_STATEMENT, evidenceIds: ['f_dddddddddd', 'f_eeeeeeeeee'],
    observedAt: overrides.observedAt ?? '2026-08-15T12:00:00.000Z', freshnessDays: 7, jurisdiction: 'PE', confidence: 0.72, scope: 'company',
  });
  report.evidenceGraph.shortIdMap.c02 = 'f_ffffffffff';
  report.evidenceGraph.signals.push({ id: 'sig_1111111111', claimId: 'c02', signalType: 'press', observedAt: overrides.observedAt ?? '2026-08-15T12:00:00.000Z', freshnessDays: 7 });
  report.analysis.signalIds = ['sig_1111111111'];
  if (overrides.auditIssue) { report.audit.status = 'warning'; report.audit.issues.push(overrides.auditIssue); }
  return report;
}

function build(reportDocument: ReportV2, signalEvidence?: boolean) {
  const snapshot = draftSnapshotFixture();
  const result = buildDraftContextV2({
    snapshot, artifact: { contentHash: canonicalSha256(snapshot), capturedAt: '2026-08-20T12:00:00.000Z' },
    seller: normalizeDraftSellerProfileV2({ name: 'Grace Hopper', companyName: 'Northstar', services: ['Automatización de operaciones'] }),
    style: createDefaultDraftWritingStyleV2(), reportDocument, now: DRAFT_FIXTURE_NOW, ...(signalEvidence === undefined ? {} : { signalEvidence }),
  });
  assert.equal(result.status, 'ready');
  if (result.status !== 'ready') throw new Error('not ready');
  return result.context;
}

test('the flag is off unless DRAFT_SIGNAL_EVIDENCE_ENABLED is true', () => {
  assert.equal(draftSignalEvidenceEnabled({}), false);
  assert.equal(draftSignalEvidenceEnabled({ DRAFT_SIGNAL_EVIDENCE_ENABLED: 'false' }), false);
  assert.equal(draftSignalEvidenceEnabled({ DRAFT_SIGNAL_EVIDENCE_ENABLED: ' true ' }), true);
});

test('without the flag the draft keeps only what the angle cites, as always', () => {
  const context = build(reportWithSignal(), false);
  const fromReport = context.evidence.filter((item) => item.provenance);
  assert.deepEqual(fromReport.map((item) => item.provenance?.kind === 'report_v2' && item.provenance.claimId), ['c01']);
  assert.equal(context.report?.outreachBrief.selectedFactualAnchorClaimIds.length, 1);
});

test('with the flag the signal the analysis chose comes first, as its own statement and as the facts that hold it, without the lead-in of the page', () => {
  const context = build(reportWithSignal(), true);
  const fromReport = context.evidence.filter((item) => item.provenance?.kind === 'report_v2');
  const statements = fromReport.map((item) => item.statement);
  assert.equal(statements[0], SIGNAL_STATEMENT, 'the crisp statement first');
  assert.ok(statements.includes('Acme publicó el aviso Auxiliar de Bodega. Vacantes publicadas: 10. Ubicación: Lima.'), 'the fact without «Así se verá:»');
  assert.ok(!statements.some((statement) => /^Así se verá/i.test(statement)));
  assert.ok(statements.includes('Acme ayuda a equipos de operaciones a reducir trabajo manual.'), 'what the angle cites is still there');
  const anchors = context.report!.outreachBrief.selectedFactualAnchorClaimIds;
  assert.match(anchors[0]!, /:claim:c02$/, 'the signal is the first anchor');
  assert.match(anchors[1]!, /:claim:c01$/);
  const first = fromReport[0]!;
  assert.equal(first.provenance?.kind === 'report_v2' && first.provenance.claimId, 'c02');
  assert.equal(first.source.url, 'https://empleos.example/acme-busca-trabajadores');
  // The writer is asked to build the email on that statement.
  assert.equal(requiredReportAwareDraftPersonalizationV2(context)[0]!.evidenceId, first.evidenceId);
});

test('a signal statement with a number or a name the facts do not write is not quoted, though its facts are', () => {
  for (const statement of [
    'Acme publicó 25 vacantes de auxiliar de bodega en Lima y busca operarios de planta en Arequipa.',
    'Acme publicó 10 vacantes de auxiliar de bodega en Cusco y busca operarios de planta en Arequipa.',
  ]) {
    const context = build(reportWithSignal({ statement }), true);
    const statements = context.evidence.filter((item) => item.provenance).map((item) => item.statement);
    assert.ok(!statements.includes(statement), statement);
    assert.ok(statements.includes('Acme busca 5 operarios de planta en Arequipa, con postulación hasta el 30 de agosto.'), 'the facts still reach the draft');
  }
});

test('a signal older than the draft accepts is not added, with or without the flag', () => {
  const context = build(reportWithSignal({ observedAt: '2026-06-01T12:00:00.000Z' }), true);
  assert.ok(!context.evidence.some((item) => item.provenance?.kind === 'report_v2' && item.provenance.claimId === 'c02'));
});

test('an invalid citation in a section the draft does not read does not discard the report, one in the angle still does', () => {
  const company = { section: 'company' as const, paragraphIndex: 1, type: 'invalid_citation' as const, fragment: 'el perfil corporativo importado indica operación en Perú', severity: 'warn' as const };
  const angle = { ...company, section: 'angle' as const };
  const reportEvidence = (context: ReturnType<typeof build>) => context.evidence.filter((item) => item.provenance).length;
  assert.equal(reportEvidence(build(reportWithSignal({ auditIssue: company }), false)), 0, 'today the whole report is discarded');
  assert.ok(reportEvidence(build(reportWithSignal({ auditIssue: company }), true)) > 0);
  assert.equal(reportEvidence(build(reportWithSignal({ auditIssue: angle }), true)), 0, 'the angle is what the draft reads');
});
