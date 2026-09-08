import {
  AnalysisV2Schema,
  ReportV2SectionKeySchema,
  validateReportV2,
  type AnalysisV2,
  type ClaimV2,
  type CommitteeMemberV2,
  type EntityResolutionV2,
  type FactV2,
  type GapV2,
  type QualificationV2,
  type ReportV2,
  type ReportV2SectionKey,
  type SectionV2,
  type SignalV2,
  type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import {
  computeReportV2Coverage,
  gapsFromMissingReportV2Fields,
  reportV2OperationalMetrics,
  type ReportV2ModelTelemetry,
} from '@/lib/report-v2-coverage';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { auditReportV2, rewriteBlockingReportV2SectionsOnce } from './audit-report-v2';
import { reasonAboutReportV2Account, type SellerProfileContextV2 } from './reason-about-report-v2-account';
import { writeReportV2Section } from './write-report-v2-section';

export const SYNTHESIZE_REPORT_V2_PROMPT_VERSION = 'report-v2/pipeline/1';

const SECTION_TITLES: Record<ReportV2SectionKey, string> = {
  verdict: 'Veredicto y proximo paso',
  snapshot: 'Ficha rapida',
  contact: 'El contacto',
  committee: 'Mapa de decision',
  company: 'Como opera la empresa',
  volume: 'Dimensionamiento',
  regulatory: 'Contexto regulatorio',
  signals: 'Senales y timing',
  fit: 'Encaje por producto',
  angle: 'Angulo de entrada',
  discovery: 'Preguntas de descubrimiento',
  objections: 'Objeciones probables',
  risks: 'Riesgos y descalificadores',
  gaps: 'Que falta y como obtenerlo',
  sources: 'Fuentes citadas',
};

const DETERMINISTIC_SECTIONS = new Set<ReportV2SectionKey>(['snapshot', 'committee', 'volume', 'sources']);

const SECTION_DIMENSIONS: Record<ReportV2SectionKey, ClaimV2['dimension'][]> = {
  verdict: ['contact_authority', 'company_overview', 'company_size', 'risk', 'regulatory'],
  snapshot: ['company_overview', 'company_industry', 'company_service', 'company_size', 'company_geography', 'company_legal_form', 'company_tech'],
  contact: ['contact_role', 'contact_tenure', 'contact_authority'],
  committee: ['buying_committee', 'contact_authority'],
  company: ['company_overview', 'company_industry', 'company_service', 'company_size', 'company_geography', 'company_tech'],
  volume: ['company_size', 'volume_estimate'],
  regulatory: ['regulatory', 'company_legal_form'],
  signals: ['signal'],
  fit: ['company_industry', 'company_service', 'company_size', 'regulatory', 'risk'],
  angle: ['signal', 'company_overview', 'company_size', 'contact_role'],
  discovery: ['risk', 'contact_authority', 'company_size', 'company_tech'],
  objections: ['risk', 'company_tech', 'company_service'],
  risks: ['risk', 'contact_authority', 'regulatory'],
  gaps: ['risk', 'contact_authority', 'company_size', 'company_overview'],
  sources: [],
};

function claimsForSection(key: ReportV2SectionKey, claims: ClaimV2[]) {
  if (key === 'sources') return claims;
  const dimensions = SECTION_DIMENSIONS[key];
  const selected = claims.filter((claim) => dimensions.includes(claim.dimension));
  return selected.length > 0 ? selected : claims.slice(0, 5);
}

function analysisForSection(key: ReportV2SectionKey, analysis: AnalysisV2, input: {
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  gaps: GapV2[];
}) {
  if (key === 'verdict') return { verdict: analysis.verdict, qualification: input.qualification };
  if (key === 'contact') return { contact: input.entity.contact, qualification: input.qualification };
  if (key === 'company') return { entity: input.entity, fitByProduct: analysis.fitByProduct };
  if (key === 'regulatory') return { fitByProduct: analysis.fitByProduct };
  if (key === 'signals') return { signalIds: analysis.signalIds };
  if (key === 'fit') return { fitByProduct: analysis.fitByProduct };
  if (key === 'angle') return analysis.entryAngle;
  if (key === 'discovery') return analysis.discoveryQuestions;
  if (key === 'objections') return analysis.objections;
  if (key === 'risks') return { riskClaimIds: analysis.riskClaimIds, blockers: analysis.verdict.blockers };
  if (key === 'gaps') return input.gaps;
  return {};
}

function deterministicSection(key: ReportV2SectionKey, input: {
  analysis: AnalysisV2;
  claims: ClaimV2[];
  sources: SourceV2[];
}): SectionV2 {
  if (key === 'committee') {
    return {
      key,
      title: SECTION_TITLES[key],
      paragraphs: [],
      blocks: [{
        type: 'committee', title: 'Personas y cargos',
        claimIds: [...new Set(input.analysis.buyingCommittee.flatMap((member) => member.claimIds))],
        payload: input.analysis.buyingCommittee,
      }],
    };
  }
  if (key === 'volume') {
    return {
      key,
      title: SECTION_TITLES[key],
      paragraphs: [],
      blocks: input.analysis.volumeModel ? [{
        type: 'table', title: 'Escenarios', claimIds: [input.analysis.volumeModel.baseClaimId], payload: input.analysis.volumeModel,
      }] : [],
    };
  }
  const claims = claimsForSection(key, input.claims);
  if (key === 'sources') {
    return {
      key,
      title: SECTION_TITLES[key],
      paragraphs: [],
      blocks: [{ type: 'sources', title: 'Fuentes utilizadas', claimIds: claims.map((claim) => claim.id), payload: input.sources.map((source) => source.id) }],
    };
  }
  return {
    key,
    title: SECTION_TITLES[key],
    paragraphs: [],
    blocks: [{ type: 'facts', title: 'Datos verificados', claimIds: claims.map((claim) => claim.id), payload: claims.map((claim) => claim.id) }],
  };
}

function withGapBlock(sections: SectionV2[], gaps: GapV2[]) {
  return sections.map((section) => section.key === 'gaps' ? {
    ...section,
    blocks: [
      ...section.blocks.filter((block) => block.type !== 'gaps'),
      { type: 'gaps' as const, title: 'Tareas de recuperacion', claimIds: [], payload: gaps },
    ],
  } : section);
}

function graphSignals(claims: ClaimV2[]): SignalV2[] {
  return claims.flatMap((claim) => (
    claim.type === 'fact' && claim.dimension === 'signal'
      ? [{
        id: buildStableReportV2Id('sig', claim.id),
        claimId: claim.id,
        signalType: 'press' as const,
        observedAt: claim.observedAt,
        freshnessDays: claim.freshnessDays,
      }]
      : []
  ));
}

export class ReportV2SynthesisFailed extends Error {
  readonly code = 'report_v2_synthesis_failed';
  readonly retryable = true;

  constructor(message = 'REPORT_V2_SYNTHESIS_FAILED') {
    super(message);
    this.name = 'ReportV2SynthesisFailed';
  }
}

export async function synthesizeReportV2(input: {
  researchSnapshotId: string;
  scope: { organizationId: string; ownerUserId: string };
  language: string;
  entity: EntityResolutionV2;
  qualification: QualificationV2;
  sources: SourceV2[];
  facts: FactV2[];
  claims: ClaimV2[];
  shortIdMap: Record<string, string | null>;
  initialGaps?: GapV2[];
  committee: CommitteeMemberV2[];
  sellerProfile: SellerProfileContextV2;
  generatedAt?: string;
  promptVersion?: string;
  revision?: number;
  synthesisContextHash?: string;
}, dependencies: {
  reason?: typeof reasonAboutReportV2Account;
  write?: typeof writeReportV2Section;
  audit?: typeof auditReportV2;
} = {}): Promise<{
  document: ReportV2;
  metrics: ReturnType<typeof reportV2OperationalMetrics>;
  metadata: { retryable: boolean; errorCode: string | null; errorMessage: string | null };
}> {
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const promptVersion = input.promptVersion || SYNTHESIZE_REPORT_V2_PROMPT_VERSION;
  const signals = graphSignals(input.claims);
  const reasoned = await (dependencies.reason || reasonAboutReportV2Account)({
    entity: input.entity,
    qualification: input.qualification,
    claims: input.claims,
    signals,
    gaps: input.initialGaps || [],
    committee: input.committee,
    sellerProfile: input.sellerProfile,
  });
  const modelTelemetry: ReportV2ModelTelemetry[] = [];
  if (reasoned.telemetry) {
    modelTelemetry.push({
      phase: 'analysis',
      section: null,
      attempt: 1,
      model: reasoned.telemetry.modelName,
      durationMs: reasoned.telemetry.durationMs,
      usage: reasoned.telemetry.usage || null,
    });
  }
  const write = dependencies.write || writeReportV2Section;
  const written = await Promise.all(ReportV2SectionKeySchema.options.map(async (key) => {
    if (DETERMINISTIC_SECTIONS.has(key)) return { section: deterministicSection(key, { analysis: reasoned.analysis, claims: input.claims, sources: input.sources }), acceptedModel: 'deterministic', attempts: 0, telemetry: [] };
    const relevantClaims = claimsForSection(key, input.claims);
    try {
      return await write({
        section: key,
        title: SECTION_TITLES[key],
        sectionInstruction: `Completa la seccion ${key} exclusivamente desde el analisis entregado.`,
        language: input.language,
        analysisSection: analysisForSection(key, reasoned.analysis, { entity: input.entity, qualification: input.qualification, gaps: [...(input.initialGaps || []), ...reasoned.additionalGaps] }),
        claimsIndex: relevantClaims,
        validClaimIds: relevantClaims.map((claim) => claim.id),
      });
    } catch {
      return { section: null, acceptedModel: null, attempts: 2, telemetry: [] };
    }
  }));
  written.forEach((result, index) => (result.telemetry || []).forEach((telemetry, telemetryIndex) => {
    modelTelemetry.push({
      phase: 'section',
      section: ReportV2SectionKeySchema.options[index],
      attempt: telemetryIndex + 1,
      model: telemetry.modelName,
      durationMs: telemetry.durationMs,
      usage: telemetry.usage || null,
    });
  }));
  const acceptedTextSections = written.filter((result) => result.section && result.acceptedModel !== 'deterministic');
  if (acceptedTextSections.length === 0) throw new ReportV2SynthesisFailed();
  let sections = ReportV2SectionKeySchema.options.map((key, index) => written[index].section || {
    key,
    title: SECTION_TITLES[key],
    paragraphs: [],
    blocks: [],
  });
  let coverage = computeReportV2Coverage({ sections, claims: input.claims });
  let gaps = gapsFromMissingReportV2Fields(coverage.missing);
  sections = withGapBlock(sections, gaps);

  const acceptedModelBySection: Record<string, string> = Object.fromEntries(written.map((result, index) => [
    ReportV2SectionKeySchema.options[index],
    result.acceptedModel || 'omitted',
  ]));
  const writerModels = [...new Set(Object.values(acceptedModelBySection).filter((model) => model !== 'deterministic' && model !== 'omitted'))];
  const audit = dependencies.audit || auditReportV2;
  let auditResult = await audit({
    sections,
    claims: input.claims,
    sources: input.sources,
    contactCountry: input.entity.contactCountry,
    writerModels,
  });
  if (auditResult.telemetry) {
    modelTelemetry.push({
      phase: 'audit', section: null, attempt: 1, model: auditResult.telemetry.modelName,
      durationMs: auditResult.telemetry.durationMs, usage: auditResult.telemetry.usage || null,
    });
  }
  if (auditResult.blockingSections.length > 0) {
    const rewritten = await rewriteBlockingReportV2SectionsOnce({
      sections,
      blockingSections: auditResult.blockingSections,
      rewrite: async (section) => {
        if (DETERMINISTIC_SECTIONS.has(section.key)) return null;
        const relevantClaims = claimsForSection(section.key, input.claims);
        let result;
        try {
          result = await write({
            section: section.key,
            title: section.title,
            sectionInstruction: `Reescribe una vez la seccion ${section.key} para corregir los defectos bloqueantes.`,
            language: input.language,
            analysisSection: analysisForSection(section.key, reasoned.analysis, { entity: input.entity, qualification: input.qualification, gaps }),
            claimsIndex: relevantClaims,
            validClaimIds: relevantClaims.map((claim) => claim.id),
          });
        } catch {
          return null;
        }
        if (result.acceptedModel) writerModels.push(result.acceptedModel);
        if (result.acceptedModel) acceptedModelBySection[section.key] = result.acceptedModel;
        (result.telemetry || []).forEach((telemetry, telemetryIndex) => modelTelemetry.push({
          phase: 'section', section: section.key, attempt: telemetryIndex + 1, model: telemetry.modelName,
          durationMs: telemetry.durationMs, usage: telemetry.usage || null,
        }));
        return result.section;
      },
    });
    sections = rewritten.sections;
    coverage = computeReportV2Coverage({ sections, claims: input.claims });
    gaps = gapsFromMissingReportV2Fields(coverage.missing);
    sections = withGapBlock(sections, gaps);
    auditResult = await audit({
      sections,
      claims: input.claims,
      sources: input.sources,
      contactCountry: input.entity.contactCountry,
      writerModels: [...new Set(writerModels)],
    });
    if (auditResult.telemetry) {
      modelTelemetry.push({
        phase: 'audit', section: null, attempt: 2, model: auditResult.telemetry.modelName,
        durationMs: auditResult.telemetry.durationMs, usage: auditResult.telemetry.usage || null,
      });
    }
  }
  if (auditResult.blockingSections.length > 0) throw new ReportV2SynthesisFailed('REPORT_V2_AUDIT_BLOCKED');

  const claimFactIds = new Set(input.claims.flatMap((claim) => claim.evidenceIds));
  const facts = input.facts.filter((fact) => claimFactIds.has(fact.id));
  const sourceIds = new Set(facts.map((fact) => fact.sourceId));
  const sources = input.sources.filter((source) => sourceIds.has(source.id));
  const assumptions = reasoned.assumptions;
  const estimates = reasoned.analysis.volumeModel?.scenarios.map((scenario) => ({
    id: buildStableReportV2Id('est', { baseClaimId: reasoned.analysis.volumeModel?.baseClaimId, scenario }),
    label: scenario.label,
    value: scenario.eventsPerMonth,
    unit: 'events_per_month',
    inputClaimIds: [reasoned.analysis.volumeModel!.baseClaimId],
    assumptionIds: assumptions.map((assumption) => assumption.id),
    formula: 'base * multiplier / 12',
  })) || [];
  const analysis = AnalysisV2Schema.parse({
    ...reasoned.analysis,
    gapIds: gaps.map((gap) => gap.id),
  });
  const document = validateReportV2({
    kind: 'research_report_document',
    schemaVersion: 'research-report-document/v2',
    id: `report-v2:${canonicalSha256({ researchSnapshotId: input.researchSnapshotId, promptVersion, synthesisContextHash: input.synthesisContextHash || null }).slice(0, 24)}`,
    revision: Math.max(1, Math.trunc(input.revision || 1)),
    researchSnapshotId: input.researchSnapshotId,
    scope: input.scope,
    language: input.language,
    entity: input.entity,
    qualification: input.qualification,
    evidenceGraph: {
      sources,
      facts,
      claims: input.claims,
      signals,
      gaps,
      assumptions,
      estimates,
      deliverables: [],
      shortIdMap: input.shortIdMap,
    },
    analysis,
    sections,
    coverage,
    audit: {
      status: auditResult.issues.length > 0 ? 'warning' : 'passed',
      model: auditResult.model,
      issues: auditResult.issues,
    },
    synthesis: {
      status: coverage.missing.length === 0 && written.every((result) => result.section) ? 'completed' : 'partial',
      provider: 'openai',
      promptVersion,
      generatedAt,
      acceptedModelBySection,
    },
  });
  const metrics = reportV2OperationalMetrics({
    sectionsAttempted: written.filter((result) => result.attempts > 0).length,
    sectionsAccepted: acceptedTextSections.length,
    sections,
    claims: input.claims,
    facts,
    sources,
    signals,
    committee: input.committee,
    modelTelemetry,
  });
  const retryable = written.some((result) => !result.section && result.attempts > 0);
  return {
    document,
    metrics,
    metadata: {
      retryable,
      errorCode: retryable ? 'report_v2_sections_incomplete' : null,
      errorMessage: retryable ? 'One or more report sections did not produce valid model output.' : null,
    },
  };
}
