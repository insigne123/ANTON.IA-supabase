import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import type { ReportV2 } from '@/lib/report-v2-contracts';
import {
  buildDraftContextV2, createDefaultDraftWritingStyleV2, draftAnchorSpecificsEnabled, draftFlagsForUser, draftHookFilterEnabled, draftSignalEvidenceEnabled, draftSignalMaxAgeDays, normalizeDraftSellerProfileV2, requiredReportAwareDraftPersonalizationV2,
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

function build(reportDocument: ReportV2, signalEvidence?: boolean, hookFilter?: boolean, anchorSpecifics?: boolean, signalMaxAgeDays?: number) {
  const snapshot = draftSnapshotFixture();
  const result = buildDraftContextV2({
    snapshot, artifact: { contentHash: canonicalSha256(snapshot), capturedAt: '2026-08-20T12:00:00.000Z' },
    seller: normalizeDraftSellerProfileV2({ name: 'Grace Hopper', companyName: 'Northstar', services: ['Automatización de operaciones'] }),
    style: createDefaultDraftWritingStyleV2(), reportDocument, now: DRAFT_FIXTURE_NOW, ...(signalEvidence === undefined ? {} : { signalEvidence }), ...(hookFilter === undefined ? {} : { hookFilter }), ...(anchorSpecifics === undefined ? {} : { anchorSpecifics }),
    ...(signalMaxAgeDays === undefined ? {} : { signalMaxAgeDays }),
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

test('DRAFT_SIGNAL_MAX_AGE_DAYS lets an older dated signal reach the email, never past what it says, and only a signal', () => {
  assert.equal(draftSignalMaxAgeDays({}), 30);
  assert.equal(draftSignalMaxAgeDays({ DRAFT_SIGNAL_MAX_AGE_DAYS: ' 90 ' }), 90);
  for (const value of ['7', '365', 'noventa', '45.5']) assert.equal(draftSignalMaxAgeDays({ DRAFT_SIGNAL_MAX_AGE_DAYS: value }), 30, value);
  // 82 days before the fixture's today: out with 30 or 60 days, in with 90.
  const reaches = (days?: number) => build(reportWithSignal({ observedAt: '2026-06-01T12:00:00.000Z' }), true, undefined, undefined, days)
    .evidence.some((item) => item.provenance?.kind === 'report_v2' && item.provenance.claimId === 'c02');
  assert.equal(reaches(), false);
  assert.equal(reaches(60), false);
  assert.equal(reaches(90), true);
  // The writer is told only when an older signal is in: a context without one is exactly what it was.
  assert.deepEqual(build(reportWithSignal({ observedAt: '2026-06-01T12:00:00.000Z' }), true, undefined, undefined, 90).writing, { olderSignal: true });
  assert.deepEqual(build(reportWithSignal({ observedAt: '2026-06-01T12:00:00.000Z' }), true, undefined, true, 90).writing, { anchorSpecifics: true, olderSignal: true });
  assert.equal('writing' in build(reportWithSignal(), true, undefined, undefined, 90), false, 'a signal of this month changes nothing');
  // The page itself must still have been read within 30 days, whatever the window.
  const stalePage = reportWithSignal({ observedAt: '2026-06-01T12:00:00.000Z' });
  stalePage.evidenceGraph.sources.find((source) => source.id === 'src_cccccccccc')!.retrievedAt = '2026-07-01T12:00:00.000Z';
  assert.ok(!build(stalePage, true, undefined, undefined, 90).evidence.some((item) => item.provenance?.kind === 'report_v2' && item.provenance.claimId === 'c02'));
});

test('an invalid citation in a section the draft does not read does not discard the report, one in the angle still does', () => {
  const company = { section: 'company' as const, paragraphIndex: 1, type: 'invalid_citation' as const, fragment: 'el perfil corporativo importado indica operación en Perú', severity: 'warn' as const };
  const angle = { ...company, section: 'angle' as const };
  const reportEvidence = (context: ReturnType<typeof build>) => context.evidence.filter((item) => item.provenance).length;
  assert.equal(reportEvidence(build(reportWithSignal({ auditIssue: company }), false)), 0, 'today the whole report is discarded');
  assert.ok(reportEvidence(build(reportWithSignal({ auditIssue: company }), true)) > 0);
  assert.equal(reportEvidence(build(reportWithSignal({ auditIssue: angle }), true)), 0, 'the angle is what the draft reads');
});

test('a signal about a death or a disaster is neither quoted nor are its facts offered, whatever the analysis chose', () => {
  const context = build(reportWithSignal({ statement: 'Acme informó con profundo pesar el fallecimiento de dos trabajadores en su operación de Arequipa.' }), true);
  const statements = context.evidence.filter((item) => item.provenance?.kind === 'report_v2').map((item) => item.statement);
  assert.ok(!statements.some((statement) => /fallecimiento|Auxiliar de Bodega|operarios de planta/.test(statement)), statements.join(' | '));
  assert.ok(statements.includes('Acme ayuda a equipos de operaciones a reducir trabajo manual.'), 'what the angle cites is still there');
});

test('the hook filter is off unless DRAFT_HOOK_FILTER_ENABLED is true', () => {
  assert.equal(draftHookFilterEnabled({}), false);
  assert.equal(draftHookFilterEnabled({ DRAFT_HOOK_FILTER_ENABLED: 'false' }), false);
  assert.equal(draftHookFilterEnabled({ DRAFT_HOOK_FILTER_ENABLED: ' true ' }), true);
});

test('the specific anchor terms are off unless DRAFT_ANCHOR_SPECIFICS_ENABLED is true', () => {
  assert.equal(draftAnchorSpecificsEnabled({}), false);
  assert.equal(draftAnchorSpecificsEnabled({ DRAFT_ANCHOR_SPECIFICS_ENABLED: 'false' }), false);
  assert.equal(draftAnchorSpecificsEnabled({ DRAFT_ANCHOR_SPECIFICS_ENABLED: ' true ' }), true);
});

const PILOT_PERSON = '5B1F0F5E-1C2D-4E3F-8A4B-0000000000AA';
const OTHER_PERSON = '00000000-0000-4000-8000-000000000001';
const ALL_ON = { DRAFT_SIGNAL_EVIDENCE_ENABLED: 'true', DRAFT_HOOK_FILTER_ENABLED: 'true', DRAFT_ANCHOR_SPECIFICS_ENABLED: 'true', DRAFT_SIGNAL_MAX_AGE_DAYS: '90' };

test('DRAFT_PILOT_USER_IDS limits the draft flags to the people of the pilot, and never turns one on by itself', () => {
  const everyone = { signalEvidence: true, hookFilter: true, anchorSpecifics: true, signalMaxAgeDays: 90 };
  const nobody = { signalEvidence: false, hookFilter: false, anchorSpecifics: false, signalMaxAgeDays: 30 };
  // Without a list each flag is what it says, for everyone: also for a draft with no known person.
  for (const person of [PILOT_PERSON, OTHER_PERSON, null, undefined]) assert.deepEqual(draftFlagsForUser(person, ALL_ON), everyone);
  assert.deepEqual(draftFlagsForUser(OTHER_PERSON, { ...ALL_ON, DRAFT_PILOT_USER_IDS: '  ,  ' }), everyone, 'an empty list is no list');
  // With a list only those people, compared without case or spaces; everyone else writes as before.
  const pilot = { ...ALL_ON, DRAFT_PILOT_USER_IDS: ` ${PILOT_PERSON.toLowerCase()} , ${'0'.repeat(8)}-0000-4000-8000-000000000009` };
  assert.deepEqual(draftFlagsForUser(PILOT_PERSON, pilot), everyone);
  assert.deepEqual(draftFlagsForUser(OTHER_PERSON, pilot), nobody);
  assert.deepEqual(draftFlagsForUser(null, pilot), nobody);
  assert.deepEqual(draftFlagsForUser('', pilot), nobody);
  // The list turns nothing on: each flag still decides by itself.
  assert.deepEqual(draftFlagsForUser(PILOT_PERSON, { DRAFT_PILOT_USER_IDS: PILOT_PERSON }), nobody);
  assert.deepEqual(draftFlagsForUser(PILOT_PERSON, { DRAFT_PILOT_USER_IDS: PILOT_PERSON, DRAFT_HOOK_FILTER_ENABLED: 'true' }), { signalEvidence: false, hookFilter: true, anchorSpecifics: false, signalMaxAgeDays: 30 });
});

test('a context built with the specific anchors says so; one built without them is exactly what it was', () => {
  const marked = build(reportWithSignal(), undefined, undefined, true);
  assert.deepEqual(marked.writing, { anchorSpecifics: true });
  const plain = build(reportWithSignal(), undefined, undefined, false);
  assert.equal('writing' in plain, false);
  // The flags of a person outside the pilot build the same context as no flags at all.
  const outside = draftFlagsForUser(OTHER_PERSON, { ...ALL_ON, DRAFT_PILOT_USER_IDS: PILOT_PERSON });
  const withFlags = build(reportWithSignal(), outside.signalEvidence, outside.hookFilter, outside.anchorSpecifics);
  assert.deepEqual(withFlags, build(reportWithSignal(), false, false, false));
  // The ones of the pilot change what the writer is given: the signal as evidence, and the marker.
  const inside = draftFlagsForUser(PILOT_PERSON, { ...ALL_ON, DRAFT_PILOT_USER_IDS: PILOT_PERSON });
  const pilotContext = build(reportWithSignal(), inside.signalEvidence, inside.hookFilter, inside.anchorSpecifics);
  assert.deepEqual(pilotContext.writing, { anchorSpecifics: true });
  assert.notDeepEqual(pilotContext.evidence, withFlags.evidence);
});

test('with the hook filter a debate on the competition of the market is not offered to the writer; without it, as always', () => {
  const debate = 'La FNE recomendó ante la Comisión de Economía del Senado prohibir la participación de Acme en la distribución minorista.';
  const withDebate = () => {
    const report = reportWithSignal();
    report.evidenceGraph.facts[0]!.text = debate;
    return report;
  };
  const statements = (context: ReturnType<typeof build>) => context.evidence.filter((item) => item.provenance?.kind === 'report_v2').map((item) => item.statement);
  assert.ok(statements(build(withDebate(), true, false)).includes(debate), 'today the fact of the angle reaches the writer, whatever it says');
  const filtered = build(withDebate(), true, true);
  assert.ok(!statements(filtered).includes(debate), 'with the filter it does not');
  assert.ok(statements(filtered)[0] === SIGNAL_STATEMENT, 'the dated signal is still the reason to write');
  assert.ok(!filtered.report!.outreachBrief.selectedFactualAnchorClaimIds.some((claimId) => /:claim:c01$/.test(claimId)), 'the claim that only stood on that fact is no anchor');
});

test('with the hook filter a gloss is not offered either, and the plain facts of the company still are', () => {
  const report = reportWithSignal();
  report.evidenceGraph.facts.push({ id: 'f_9999999999', sourceId: report.evidenceGraph.facts[0]!.sourceId, text: '—Who is who Acme is the regulated utility, and Lima and Callao are communes of the region.', observedAt: null, jurisdiction: null, locator: 'block:9' });
  (report.evidenceGraph.claims[0]!.evidenceIds as string[]).push('f_9999999999');
  const statements = (context: ReturnType<typeof build>) => context.evidence.filter((item) => item.provenance?.kind === 'report_v2').map((item) => item.statement);
  assert.ok(statements(build(report, true, false)).some((statement) => /Who is who/.test(statement)));
  const filtered = statements(build(report, true, true));
  assert.ok(!filtered.some((statement) => /Who is who/.test(statement)), filtered.join(' | '));
  assert.ok(filtered.includes('Acme ayuda a equipos de operaciones a reducir trabajo manual.'), 'the plain description of the company stays');
});
