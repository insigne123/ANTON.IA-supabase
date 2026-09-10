import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisV2, SectionV2 } from '@/lib/report-v2-contracts';
import { validateReportV2CoverageGapConsistency } from '@/lib/report-v2-coverage';
import { synthesizeReportV2 } from './synthesize-report-v2';
import { ReportV2EditorCitationError } from './write-report-v2';

const entity = {
  companyName: 'Acme', companyDomain: 'acme.example', contactCountry: 'PE' as const,
  operatingCountries: ['PE'], countryScopedPaths: {}, excludedPaths: [], ambiguities: [],
  contact: { fullName: 'Ada', title: 'Coordinadora de Seleccion', seniority: 'coordinator' as const, department: 'RRHH', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null },
};
const analysis: AnalysisV2 = {
  verdict: { headline: 'Explorar un piloto de coordinacion.', qualification: 'qualified', recommendedProduct: 'automation', nextAction: 'Preguntar como coordinan entrevistas.', blockers: [] },
  buyingCommittee: [], volumeModel: null, signalIds: [], fitByProduct: [],
  entryAngle: { channel: 'LinkedIn', timing: 'Sin urgencia conocida.', hooks: ['Coordinacion de entrevistas'] },
  discoveryQuestions: [{ question: 'Como se coordinan las entrevistas?', validatesClaimId: null }],
  objections: [], riskClaimIds: [], gapIds: [],
};
const input = {
  researchSnapshotId: 'snapshot-review', scope: { organizationId: 'org', ownerUserId: 'owner' }, language: 'es', entity,
  qualification: { verdict: 'qualified' as const, reasons: ['icp_rules_missing'], redirectTo: [], allowedDepth: 'shallow' as const },
  sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], sellerProfile: { products: [{ key: 'automation' }] },
};
const keys = ['verdict', 'company', 'contact', 'fit', 'angle', 'discovery'] as const;
const sections = (): SectionV2[] => keys.map((key) => ({ key, title: key, paragraphs: [{ text: 'Explorar la coordinacion de entrevistas con el equipo de seleccion.', claimIds: [], basis: 'recommendation', context: 'target' }], blocks: [] }));
const telemetry = { modelName: 'gpt-5.6-terra', durationMs: 1, usage: { total_tokens: 20 } };
const reason = async () => ({ analysis, assumptions: [], additionalGaps: [], telemetry, specialists: [] });
const cleanAudit = async () => ({ model: 'gpt-5.6-terra', issues: [], blockingSections: [], telemetry });

test('prepares a complete useful report from profile context without mandatory news, size or citations', async () => {
  let writes = 0;
  const result = await synthesizeReportV2(input, { reason, audit: cleanAudit, write: async () => { writes += 1; return { sections: sections(), telemetry }; } });
  assert.equal(writes, 1);
  assert.equal(result.document.sections.length, 15);
  assert.equal(result.document.synthesis.status, 'completed');
  assert.equal(result.document.coverage.ratio, 1);
  assert.equal(result.document.evidenceGraph.signals.length, 0);
  assert.equal(result.document.analysis.volumeModel, null);
  assert.equal(result.metadata.retryable, false);
  assert.doesNotThrow(() => validateReportV2CoverageGapConsistency(result.document));
});

test('passes the actual blocking fragments to a single targeted repair and preserves accepted sections', async () => {
  let writes = 0;
  let audits = 0;
  const result = await synthesizeReportV2(input, {
    reason,
    write: async (request) => {
      writes += 1;
      if (!request.repair) return { sections: sections(), telemetry };
      assert.deepEqual(request.repair.sections.map((section) => section.key), ['fit']);
      assert.ok(JSON.stringify(request.repair.issues).includes('invented budget'));
      return { sections: [{ ...sections()[3], paragraphs: [{ text: 'Proponer un piloto sin asumir presupuesto ni compra confirmada.', claimIds: [], context: 'target', basis: 'recommendation' }] }], telemetry };
    },
    audit: async () => {
      audits += 1;
      return audits > 1 ? cleanAudit() : { model: 'gpt-5.6-terra', issues: [{ section: 'fit', paragraphIndex: 0, type: 'hard_hypothesis', severity: 'block', fragment: 'invented budget' }], blockingSections: ['fit'], telemetry };
    },
  });
  assert.equal(writes, 2);
  assert.equal(audits, 2);
  assert.equal(result.document.sections.find((section) => section.key === 'company')?.paragraphs[0].text, sections()[1].paragraphs[0].text);
  assert.equal(result.document.synthesis.status, 'completed');
});

test('withholds only unresolved unsupported content instead of discarding the usable report or looping', async () => {
  const result = await synthesizeReportV2(input, {
    reason, write: async () => ({ sections: sections(), telemetry }),
    audit: async () => ({ model: 'gpt-5.6-terra', issues: [{ section: 'fit', paragraphIndex: 0, type: 'hard_hypothesis', severity: 'block', fragment: 'unsupported' }], blockingSections: ['fit'], telemetry }),
  });
  assert.equal(result.document.synthesis.status, 'partial');
  assert.equal(result.document.sections.find((section) => section.key === 'fit')?.paragraphs.length, 0);
  assert.equal(result.document.sections.find((section) => section.key === 'contact')?.paragraphs.length, 1);
  assert.equal(result.metadata.errorCode, 'report_v2_content_withheld');
  assert.equal(result.metadata.retryable, false);
  assert.doesNotThrow(() => validateReportV2CoverageGapConsistency(result.document));
});

test('invalid editor citations consume the single repair budget and still undergo factual audit', async () => {
  for (const blocked of [false, true]) {
    let writes = 0;
    let analyses = 0;
    const result = await synthesizeReportV2(input, {
      reason: async () => { analyses++; return reason(); },
      write: async (request) => {
        if (++writes === 1) throw new ReportV2EditorCitationError(sections(), telemetry);
        assert.equal(request.repair?.sections.length, 6);
        return { sections: sections(), telemetry };
      },
      audit: async () => blocked ? { model: telemetry.modelName, issues: [{ section: 'fit', paragraphIndex: 0, type: 'hard_hypothesis', severity: 'block', fragment: 'unsupported' }], blockingSections: ['fit'], telemetry } : cleanAudit(),
    });
    assert.equal(writes, 2);
    assert.equal(analyses, 1);
    assert.equal(result.document.synthesis.status, blocked ? 'partial' : 'completed');
    assert.equal(result.metrics.modelTelemetry?.filter((call) => call.phase === 'section').length, 2);
  }
});

test('an empty writer never yields a successful document', async () => {
  await assert.rejects(synthesizeReportV2(input, { reason, write: async () => ({ sections: [], telemetry }), audit: cleanAudit }), /REPORT_V2_SYNTHESIS_FAILED/);
});

test('a failed independent review never claims a passed report', async () => {
  await assert.rejects(synthesizeReportV2(input, { reason, write: async () => ({ sections: sections(), telemetry }), audit: async () => { throw new Error('auditor unavailable'); } }), /auditor unavailable/);
});

test('missing core prose is a retryable editorial failure, not a permanently incomplete report', async () => {
  await assert.rejects(synthesizeReportV2(input, { reason, write: async () => ({ sections: sections().slice(0, 1), telemetry }), audit: cleanAudit }), /CORE_SECTIONS_INCOMPLETE/);
});

test('a disputed factual citation never resurfaces in the published evidence graph', async () => {
  const citedSections = sections();
  citedSections[3].paragraphs[0].claimIds = ['c01'];
  await assert.rejects(synthesizeReportV2(input, {
    reason, write: async () => ({ sections: citedSections, telemetry }),
    audit: async () => ({ model: 'gpt-5.6-terra', issues: [{ section: 'fit', paragraphIndex: 0, type: 'invalid_citation', severity: 'block', fragment: 'disputed fact' }], blockingSections: ['fit'], telemetry }),
  }), /EVIDENCE_REVIEW_REQUIRED/);
});

test('unresolved invented seller traction is repaired once then withheld, never published as a suggested opening', async () => {
  const fragment = 'Ya ayudamos a cien empresas del sector.';
  let writes = 0;
  let audits = 0;
  const result = await synthesizeReportV2(input, {
    reason,
    write: async (request) => {
      writes++;
      if (request.repair) {
        assert.deepEqual(request.repair.sections.map((section) => section.key), ['angle']);
        assert.ok(JSON.stringify(request.repair.issues).includes(fragment));
      }
      return { sections: sections().map((section) => section.key === 'angle' ? { ...section, paragraphs: [{ text: fragment, basis: 'recommendation', claimIds: [], context: 'target' }] } : section), telemetry };
    },
    audit: async () => {
      audits++;
      return { model: 'gpt-5.6-luna', issues: [{ section: 'angle', paragraphIndex: 0, type: 'hard_hypothesis', severity: 'block', fragment }], blockingSections: ['angle'], telemetry };
    },
  });
  assert.equal(writes, 2);
  assert.equal(audits, 2);
  assert.equal(result.document.synthesis.status, 'partial');
  assert.equal(result.document.sections.find((section) => section.key === 'angle')?.paragraphs.length, 0);
  assert.equal(result.metadata.errorCode, 'report_v2_content_withheld');
});

test('shared provenance persists and every private report audits uncited evidence and original source timestamps', async () => {
  const { PUBLIC_COMPANY_COVERAGE_LIMITATION, PUBLIC_COMPANY_EXTERNAL_MISSING } = await import('@/lib/public-company-research-contracts');
  const researchWarnings = [PUBLIC_COMPANY_COVERAGE_LIMITATION, PUBLIC_COMPANY_EXTERNAL_MISSING];
  const publicCompanyResearch = { artifactId: '00000000-0000-4000-8000-000000000001', revision: 2, expiresAt: '2026-09-09T00:00:00.000Z' };
  const sources = [{ id: 'src_1234567890', url: 'https://acme.example/', canonicalUrl: 'https://acme.example/', title: 'Acme',
    sourceType: 'corporate' as const, jurisdiction: null, publishedAt: null, modifiedAt: null, retrievedAt: '2026-09-08T00:00:00.000Z', ownDomain: true, contentHash: 'a'.repeat(64) }];
  const facts = [{ id: 'f_1234567890', sourceId: sources[0].id, text: 'Public uncited evidence must remain visible to the auditor.', observedAt: null, jurisdiction: null, locator: 'block:1' }];
  let audits = 0;
  for (const owner of ['owner-a', 'owner-b']) {
    const result = await synthesizeReportV2({ ...input, sources, facts, publicCompanyResearch, researchWarnings,
      scope: { organizationId: 'org', ownerUserId: owner }, entity: { ...entity, contact: { ...entity.contact, fullName: owner } } }, {
      reason, write: async () => ({ sections: sections(), telemetry }),
      audit: async (request) => {
        audits += 1;
        assert.deepEqual(request.facts, facts);
        assert.deepEqual(request.sources, sources);
        assert.equal(request.entity?.contact.fullName, owner);
        assert.deepEqual(request.sellerProfile, input.sellerProfile);
        assert.equal(request.sections.length, 15);
        return cleanAudit();
      },
    });
    assert.deepEqual(result.document.publicCompanyResearch, publicCompanyResearch);
    assert.deepEqual(result.document.evidenceGraph.facts, facts);
    assert.equal(result.document.scope.ownerUserId, owner);
    assert.ok(result.document.audit.issues.some((issue) => issue.fragment === PUBLIC_COMPANY_COVERAGE_LIMITATION));
    assert.ok(result.document.audit.issues.some((issue) => /corporativa.*contacto.*por separado/.test(issue.fragment)));
    assert.equal(result.metadata.retryable, false);
  }
  assert.equal(audits, 2);
});
