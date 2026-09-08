import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import { parseWebEvidenceV2, resolveEntityFromExistingContextV2 } from '@/lib/report-v2-extraction';
import { qualifyEntityV2 } from '@/qualification/icp-gate';
import { buildReportV2Committee } from './build-report-v2-committee';
import { buildReportV2VolumeModel } from './build-report-v2-volume';
import { consolidateReportV2Claims, extractClaimsFromSourcesV2, REPORT_V2_TARGET_FIELDS } from './extract-report-v2-claims';
import { synthesizeReportV2 } from './synthesize-report-v2';

const fixtureRoot = 'test/fixtures/grupoexpro';
const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync(`${fixtureRoot}/provider-context.json`, 'utf8'));
const serper = JSON.parse(readFileSync(`${fixtureRoot}/serper-results.json`, 'utf8'));

test('GrupoExpro frozen fixture produces an audited 15-section Report V2 without network dependencies', async () => {
  const parsedSources = serper.results.map((result: any) => parseWebEvidenceV2({
    html: readFileSync(`${fixtureRoot}/${result.fixture}`, 'utf8'),
    url: result.link,
    targetDomain: golden.domain,
    retrievedAt: golden.capturedAt,
  }));
  const entity = resolveEntityFromExistingContextV2({ contact: provider.contact, domain: golden.domain, sources: parsedSources });
  const qualification = qualifyEntityV2({ entity, rules: golden.sellerProfile.icpRules, headcount: 12_000 });
  const extracted = await extractClaimsFromSourcesV2({
    companyName: entity.companyName,
    companyDomain: entity.companyDomain,
    sources: parsedSources,
    providerContext: provider.contact,
    capturedAt: golden.capturedAt,
  }, { generate: (async () => ({ claims: [], notFoundFields: [...REPORT_V2_TARGET_FIELDS] })) as any });
  const consolidated = consolidateReportV2Claims({ drafts: extracted.claimDrafts, facts: extracted.facts });
  const committee = buildReportV2Committee({ entity, qualification, claims: consolidated.claims, persistedApolloPeople: provider.persistedPeople });
  const scaleClaim = consolidated.claims.find((claim) => claim.dimension === 'company_size' && claim.statement.includes('12000'))!;
  const volume = buildReportV2VolumeModel({
    claims: consolidated.claims,
    entity,
    assumptions: golden.sellerProfile.products[0].volumeAssumptions,
  });
  assert.ok(volume);
  const signals = consolidated.claims.filter((claim) => claim.dimension === 'signal').map((claim) => ({
    id: buildStableReportV2Id('sig', claim.id),
    claimId: claim.id,
    signalType: 'press' as const,
    observedAt: claim.type === 'fact' ? claim.observedAt : golden.capturedAt,
    freshnessDays: claim.freshnessDays,
  }));
  const fitClaim = consolidated.claims.find((claim) => !claim.jurisdiction || claim.jurisdiction === 'GLOBAL' || claim.jurisdiction === 'PE') || scaleClaim;

  const result = await synthesizeReportV2({
    researchSnapshotId: 'snapshot-grupoexpro',
    scope: { organizationId: 'organization-fixture', ownerUserId: 'user-fixture' },
    language: 'es',
    entity,
    qualification,
    sources: extracted.sources,
    facts: extracted.facts,
    claims: consolidated.claims,
    shortIdMap: consolidated.shortIdMap,
    committee,
    sellerProfile: golden.sellerProfile,
    generatedAt: golden.capturedAt,
  }, {
    reason: (async () => ({
      analysis: {
        verdict: {
          headline: 'La cuenta conserva potencial, pero el contacto y la jurisdiccion requieren redireccion.',
          qualification: qualification.verdict,
          recommendedProduct: 'NONE',
          nextAction: 'Contactar al Director Corporativo de Negocios y validar alcance local.',
          blockers: qualification.reasons,
        },
        buyingCommittee: committee,
        volumeModel: volume!.model,
        signalIds: signals.map((signal) => signal.id),
        fitByProduct: [{
          productKey: 'product-a',
          verdict: 'disqualified',
          rationale: 'El producto configurado no cubre Peru.',
          claimIds: [fitClaim.id],
          headquartersContextClaimIds: fitClaim.jurisdiction === 'CL' ? [fitClaim.id] : [],
          validationQuestion: 'Existe otra oferta habilitada para Peru?',
        }],
        entryAngle: { channel: 'email', timing: 'Despues de redirigir el contacto.', hooks: ['Escala regional y estacionalidad'] },
        discoveryQuestions: [],
        objections: [],
        riskClaimIds: [],
        gapIds: [],
      },
      assumptions: volume!.assumptions,
      additionalGaps: volume!.gap ? [volume!.gap] : [],
      telemetry: { modelName: 'gpt-5.6-sol', durationMs: 10, usage: { total_tokens: 100 } },
    })) as any,
    write: (async (input: any) => {
      const claimId = input.validClaimIds[0];
      const claim = consolidated.claims.find((item) => item.id === claimId);
      return {
        section: {
          key: input.section,
          title: input.title,
          paragraphs: [{
            text: `${claim?.statement || 'La evidencia disponible orienta el siguiente paso.'}`,
            claimIds: [claimId],
            context: claim?.jurisdiction === 'CL' && entity.contactCountry !== 'CL' ? 'headquarters' : 'target',
          }],
          blocks: [],
        },
        acceptedModel: 'gpt-5.6-luna',
        attempts: 1,
        telemetry: [{ modelName: 'gpt-5.6-luna', durationMs: 5, usage: { total_tokens: 50 } }],
      };
    }) as any,
    audit: (async () => ({
      model: 'gpt-5.6-sol', issues: [], blockingSections: [],
      telemetry: { modelName: 'gpt-5.6-sol', durationMs: 4, usage: { total_tokens: 25 } },
    })) as any,
  });

  const report = result.document;
  const allText = report.evidenceGraph.claims.map((claim) => claim.statement).join(' ');
  assert.equal(report.sections.length, 15);
  assert.equal(report.entity.contactCountry, golden.expected.contactCountry);
  assert.equal(report.qualification.verdict, golden.expected.qualificationVerdict);
  assert.ok(report.analysis.volumeModel && report.analysis.volumeModel.scenarios.length === 3);
  assert.ok(report.evidenceGraph.signals.length >= golden.expected.minimumSignals);
  assert.ok(report.evidenceGraph.signals.every((signal) => signal.observedAt));
  assert.ok(report.analysis.buyingCommittee.some((member) => member.name && member.name !== golden.contact.fullName));
  golden.expected.requiredNumbers.forEach((number: number) => assert.match(allText, new RegExp(`\\b${number}\\b`)));
  assert.ok(result.metrics.ownDomainSourceRatio < golden.expected.maximumOwnDomainSourceRatio);
  assert.ok(!report.audit.issues.some((issue) => issue.severity === 'block'));
  assert.ok(report.evidenceGraph.claims.every((claim) => !/[<>]|elementor|wp-content|hummingbird/i.test(claim.statement)));
  assert.ok((result.metrics.modelTelemetry || []).some((entry) => entry.phase === 'analysis' && entry.usage?.total_tokens === 100));
  assert.ok((result.metrics.modelTelemetry || []).some((entry) => entry.phase === 'section' && entry.durationMs === 5));
  assert.ok((result.metrics.modelTelemetry || []).some((entry) => entry.phase === 'audit' && entry.model === 'gpt-5.6-sol'));
});

test('a total P6 failure never returns a Report V2 document', async () => {
  await assert.rejects(synthesizeReportV2({
    researchSnapshotId: 'snapshot-empty',
    scope: { organizationId: 'organization-fixture', ownerUserId: 'user-fixture' },
    language: 'es',
    entity: {
      companyName: 'Example', companyDomain: 'example.test', contactCountry: 'PE', operatingCountries: ['PE'], countryScopedPaths: {}, excludedPaths: [],
      contact: { fullName: 'Person', title: 'Director', seniority: 'director', department: 'Operations', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null }, ambiguities: [],
    },
    qualification: { verdict: 'qualified', reasons: [], redirectTo: [], allowedDepth: 'deep' },
    sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], sellerProfile: { products: [] },
  }, {
    reason: (async () => ({
      analysis: {
        verdict: { headline: 'No evidence.', qualification: 'qualified', recommendedProduct: 'NONE', nextAction: 'Collect evidence.', blockers: [] },
        buyingCommittee: [], volumeModel: null, signalIds: [], fitByProduct: [], entryAngle: { channel: 'email', timing: 'Later', hooks: [] },
        discoveryQuestions: [], objections: [], riskClaimIds: [], gapIds: [],
      }, assumptions: [], additionalGaps: [],
    })) as any,
    write: (async () => ({ section: null, acceptedModel: null, attempts: 2 })) as any,
    audit: (async () => ({ model: 'auditor', issues: [], blockingSections: [] })) as any,
  }), /REPORT_V2_SYNTHESIS_FAILED/);
});
