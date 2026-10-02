import {
  AnalysisV2Schema, REPORT_V2_ANGLE_TITLE, ReportV2SectionKeySchema, validateReportV2,
  type AnalysisV2, type ClaimV2, type CommitteeMemberV2, type EntityResolutionV2, type FactV2, type GapV2,
  type QualificationV2, type ReportV2, type SectionV2, type SourceV2,
} from '@/lib/report-v2-contracts';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import {
  computeReportV2Coverage,
  gapsFromMissingReportV2Fields,
  projectReportV2ModelEvidence,
  reportV2OperationalMetrics,
  type ReportV2ModelTelemetry,
} from '@/lib/report-v2-coverage';
import { depthFromAllowedDepth, getResearchDepthBudget } from '@/lib/research-depth-budgets';
import type { ResearchDepth } from '@/lib/research-depth-budgets';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { PUBLIC_COMPANY_COVERAGE_LIMITATION, PUBLIC_COMPANY_EXTERNAL_MISSING } from '@/lib/public-company-research-contracts';
import { auditReportV2 } from './audit-report-v2';
import { reasonAboutReportV2Account, type SellerProfileContextV2 } from './reason-about-report-v2-account';
import { ReportV2EditorCitationError, writeReportV2 } from './write-report-v2';

export const SYNTHESIZE_REPORT_V2_PROMPT_VERSION = 'report-v2/pipeline/4';

export class ReportV2SynthesisFailed extends Error {
  readonly code = 'report_v2_synthesis_failed';
  readonly retryable = true;
  constructor(message = 'REPORT_V2_SYNTHESIS_FAILED') { super(message); this.name = 'ReportV2SynthesisFailed'; }
}

/** The withheld claims and every derived claim that rests on one of them, however far down. */
function withheldWithDerived(withheld: Set<string>, claims: ClaimV2[]) {
  const all = new Set(withheld);
  for (let changed = true; changed;) {
    changed = false;
    for (const claim of claims) {
      if (all.has(claim.id) || claim.type !== 'derived' || !claim.inputs.some((id) => all.has(id))) continue;
      all.add(claim.id);
      changed = true;
    }
  }
  return all;
}

/** The analysis without what rests on a withheld claim: a volume model on it goes, the rest loses only that reference. */
function withoutWithheldClaims(analysis: AnalysisV2, withheld: Set<string>, signals: Array<{ id: string }>): AnalysisV2 {
  if (!withheld.size) return analysis;
  const kept = (ids: string[]) => ids.filter((id) => !withheld.has(id));
  const signalIds = new Set(signals.map((signal) => signal.id));
  return {
    ...analysis,
    buyingCommittee: analysis.buyingCommittee.map((member) => ({ ...member, claimIds: kept(member.claimIds) })),
    volumeModel: analysis.volumeModel && withheld.has(analysis.volumeModel.baseClaimId) ? null : analysis.volumeModel,
    signalIds: analysis.signalIds.filter((id) => signalIds.has(id)),
    fitByProduct: analysis.fitByProduct.map((fit) => ({ ...fit, claimIds: kept(fit.claimIds), headquartersContextClaimIds: kept(fit.headquartersContextClaimIds) })),
    discoveryQuestions: analysis.discoveryQuestions.map((question) => question.validatesClaimId && withheld.has(question.validatesClaimId)
      ? { ...question, validatesClaimId: null } : question),
    objections: analysis.objections.map((objection) => ({ ...objection, derivedFrom: kept(objection.derivedFrom) })),
    riskClaimIds: kept(analysis.riskClaimIds),
  };
}

export async function synthesizeReportV2(input: {
  researchSnapshotId: string;
  publicCompanyResearch?: { artifactId: string; revision: number; expiresAt: string };
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
  companyContext?: string | null;
  generatedAt?: string;
  promptVersion?: string;
  revision?: number;
  synthesisContextHash?: string;
  depth?: ResearchDepth;
  researchWarnings?: string[];
  researchMetrics?: { queries: number; pages: number; elapsedMs: number };
  signal?: AbortSignal;
}, dependencies: {
  reason?: typeof reasonAboutReportV2Account;
  write?: typeof writeReportV2;
  audit?: typeof auditReportV2;
} = {}): Promise<{
  document: ReportV2;
  metrics: ReturnType<typeof reportV2OperationalMetrics>;
  metadata: { retryable: boolean; errorCode: string | null; errorMessage: string | null };
}> {
  const generatedAt = new Date(input.generatedAt || Date.now()).toISOString();
  const promptVersion = input.promptVersion || SYNTHESIZE_REPORT_V2_PROMPT_VERSION;
  const signal = AbortSignal.any([AbortSignal.timeout(210_000), ...(input.signal ? [input.signal] : [])]);
  const signals = input.claims.flatMap((claim) => claim.type === 'fact' && claim.dimension === 'signal' && claim.observedAt ? [{
    id: buildStableReportV2Id('sig', claim.id), claimId: claim.id, signalType: 'press' as const,
    observedAt: claim.observedAt, freshnessDays: claim.freshnessDays,
  }] : []);
  const researchDepth = input.depth || depthFromAllowedDepth(input.qualification.allowedDepth);
  const depthBudget = getResearchDepthBudget(researchDepth);
  const modelEvidence = projectReportV2ModelEvidence({
    sources: input.sources,
    facts: input.facts,
    claims: input.claims,
    budget: { maxTotal: depthBudget.maxEvidence, maxFacts: depthBudget.maxEvidence },
  });
  const modelClaimIds = new Set(modelEvidence.claims.map((claim) => claim.id));
  const modelCommittee = input.committee.map((member) => ({
    ...member,
    claimIds: member.claimIds.filter((claimId) => modelClaimIds.has(claimId)),
  }));
  const modelSignals = signals.filter((signal) => modelClaimIds.has(signal.claimId));
  const modelInput = {
    ...input,
    sources: modelEvidence.sources,
    facts: modelEvidence.facts,
    claims: modelEvidence.claims,
    shortIdMap: Object.fromEntries(modelEvidence.claims.map((claim) => [claim.id, claim.internalId])),
    committee: modelCommittee,
  };
  const reasoned = await (dependencies.reason || reasonAboutReportV2Account)({ ...modelInput, signal, signals: modelSignals, gaps: input.initialGaps || [] });
  const modelTelemetry: ReportV2ModelTelemetry[] = [];
  const track = (phase: ReportV2ModelTelemetry['phase'], attempt: number, telemetry: { modelName: string; durationMs: number; usage?: Record<string, unknown> | null } | null | undefined) => {
    if (telemetry) modelTelemetry.push({ phase, section: null, attempt, model: telemetry.modelName, durationMs: telemetry.durationMs, usage: telemetry.usage || null });
  };
  track('analysis', 1, reasoned.telemetry);
  for (const specialist of reasoned.specialists || []) track('analysis', 1, specialist.telemetry);
  const write = dependencies.write || writeReportV2;
  const editorialInput = { ...modelInput, signal, signals: modelSignals, analysis: reasoned.analysis };
  let written: Awaited<ReturnType<typeof writeReportV2>>;
  let repairUsed = false;
  try {
    written = await write(editorialInput);
    track('section', 1, written.telemetry);
  } catch (error) {
    if (!(error instanceof ReportV2EditorCitationError)) throw error;
    track('section', 1, error.telemetry);
    repairUsed = true;
    written = await write({ ...editorialInput, repair: { sections: error.sections, issues: 'Corrige claimIds inexistentes o basis=source sin respaldo. Usa los IDs permitidos; perfil, ausencia de datos, hipotesis y recomendaciones sin hechos nuevos usan su basis correspondiente, sin citas decorativas. Devuelve todas estas secciones completas.' } });
    track('section', 2, written.telemetry);
  }
  const acceptedModelBySection: Record<string, string> = {};
  // Keep the stored V2 section envelope readable by existing clients, without requiring optional prose.
  let sections: SectionV2[] = ReportV2SectionKeySchema.options.map((key) => {
    const section = written.sections.find((section) => section.key === key);
    acceptedModelBySection[key] = section?.paragraphs.length ? written.telemetry.modelName : 'omitted';
    return section || { key, title: key, paragraphs: [], blocks: [] };
  });
  if (!sections.some((section) => section.paragraphs.length)) throw new ReportV2SynthesisFailed();
  if (computeReportV2Coverage({ sections, claims: input.claims, commercial: true }).missing.length) throw new ReportV2SynthesisFailed('REPORT_V2_CORE_SECTIONS_INCOMPLETE');
  const audit = dependencies.audit || auditReportV2;
  // Audit keeps the complete graph so uncited or conflicting evidence is still
  // reviewed and preserved for provenance; reasoning and writing use the bounded projection.
  const auditInput = { claims: input.claims, facts: input.facts, sources: input.sources, entity: input.entity, companyContext: input.companyContext, sellerProfile: input.sellerProfile, contactCountry: input.entity.contactCountry, writerModels: [written.telemetry.modelName], signal };
  let review = await audit({ ...auditInput, sections });
  track('audit', 1, review.telemetry);
  if (review.blockingSections.length && !repairUsed) {
    const blocked = new Set(review.blockingSections);
    try {
      const repaired = await write({ ...editorialInput, repair: { sections: sections.filter((section) => blocked.has(section.key)), issues: review.issues.filter((issue) => issue.severity === 'block') } });
      track('section', 2, repaired.telemetry);
      const repairedSections = sections.map((section) => {
        const replacement = blocked.has(section.key) ? repaired.sections.find((item) => item.key === section.key) : null;
        return replacement || section;
      });
      const repairedReview = await audit({ ...auditInput, sections: repairedSections });
      sections = repairedSections;
      review = repairedReview;
      for (const section of repaired.sections) if (blocked.has(section.key)) acceptedModelBySection[section.key] = repaired.telemetry.modelName;
      track('audit', 2, review.telemetry);
    } catch {
      // The initial review still identifies exactly which content must not be delivered.
    }
  }
  const removedContent = review.issues.some((issue) => issue.severity === 'block');
  // Claims the review disputed, with everything derived from them: they leave the report.
  let withheld = new Set<string>();
  if (removedContent) {
    // A disputed factual anchor also exists in the evidence graph and draft consumers: hiding the paragraph that exposed it
    // is not enough. It leaves the graph too, and so does every paragraph, block and analysis entry that rests on it; the
    // rest of the report is delivered «con salvedades» instead of failing the whole research (the 1 Oct test lost the
    // report after 303 s on two such reviews).
    for (const issue of review.issues) {
      if (issue.severity !== 'block') continue;
      const section = sections.find((section) => section.key === issue.section);
      const paragraphs = issue.paragraphIndex === null ? section?.paragraphs : section?.paragraphs.slice(issue.paragraphIndex, issue.paragraphIndex + 1);
      for (const paragraph of paragraphs || []) for (const id of paragraph.claimIds) withheld.add(id);
    }
    withheld = withheldWithDerived(withheld, input.claims);
    sections = sections.map((section) => {
      const issues = review.issues.filter((issue) => issue.severity === 'block' && issue.section === section.key);
      const paragraphs = section.paragraphs.filter((paragraph, index) => !issues.some((issue) => issue.paragraphIndex === null || issue.paragraphIndex === index)
        && !paragraph.claimIds.some((id) => withheld.has(id)));
      if (paragraphs.length === section.paragraphs.length && !section.blocks.some((block) => block.claimIds.some((id) => withheld.has(id)))) return section;
      if (!paragraphs.length) acceptedModelBySection[section.key] = 'omitted';
      return { ...section, paragraphs, blocks: section.blocks.map((block) => ({ ...block, claimIds: block.claimIds.filter((id) => !withheld.has(id)) })) };
    });
  }
  const claims = input.claims.filter((claim) => !withheld.has(claim.id));
  const deliveredSignals = signals.filter((signal) => !withheld.has(signal.claimId));
  if (!sections.find((section) => section.key === 'verdict')?.paragraphs.length) throw new ReportV2SynthesisFailed('REPORT_V2_VERDICT_NOT_VALIDATED');

  const coverage = computeReportV2Coverage({ sections, claims, commercial: true });
  const gaps = gapsFromMissingReportV2Fields(coverage.missing);
  const analysis = AnalysisV2Schema.parse({ ...withoutWithheldClaims(reasoned.analysis, withheld, deliveredSignals), gapIds: gaps.map((gap) => gap.id) });
  const assumptions = reasoned.assumptions;
  const estimates = analysis.volumeModel?.scenarios.map((scenario) => ({
    id: buildStableReportV2Id('est', { base: analysis.volumeModel!.baseClaimId, scenario }), label: scenario.label,
    value: scenario.eventsPerMonth, unit: 'events_per_month', inputClaimIds: [analysis.volumeModel!.baseClaimId],
    assumptionIds: assumptions.map((item) => item.id), formula: 'base * multiplier / 12',
  })) || [];
  sections = sections.map((section) => {
    if (section.key === 'sources') return { ...section, title: 'Fuentes y lecturas', blocks: [{ type: 'sources' as const, title: 'Respaldo y contexto adicional', claimIds: claims.map((claim) => claim.id), payload: input.sources.map((source) => source.id) }] };
    if (section.key === 'committee') return { ...section, title: 'Personas a involucrar', blocks: analysis.buyingCommittee.length ? [{ type: 'committee' as const, title: 'Contacto y roles', claimIds: [...new Set(analysis.buyingCommittee.flatMap((member) => member.claimIds))], payload: analysis.buyingCommittee }] : [] };
    if (section.key === 'volume' && analysis.volumeModel) return { ...section, title: 'Escenarios de volumen', blocks: [{ type: 'table' as const, title: 'Supuestos configurados', claimIds: [analysis.volumeModel.baseClaimId], payload: analysis.volumeModel }] };
    if (section.key === 'gaps' && gaps.length) return { ...section, title: 'Pendientes relevantes', blocks: [{ type: 'gaps' as const, title: 'Para completar la preparacion', claimIds: [], payload: gaps }] };
    if (section.key === 'angle' && section.paragraphs.length) return { ...section, title: REPORT_V2_ANGLE_TITLE };
    return section;
  });
  const issues = review.issues.map((issue) => issue.severity === 'block'
    ? { ...issue, severity: 'warn' as const, fragment: 'Se retiro contenido que no supero la revision; no utilizarlo sin confirmar.' }
    : issue);
  if (withheld.size) issues.push({ section: 'sources', paragraphIndex: null, type: 'generic', severity: 'warn',
    fragment: `Informe con salvedades: se retiraron ${withheld.size} ${withheld.size === 1 ? 'afirmacion' : 'afirmaciones'} que la revision no pudo confirmar. Confirma esos datos antes de usarlos en un correo.` });
  if (input.researchWarnings?.includes('web_context_unavailable')) issues.push({ section: 'sources', paragraphIndex: null, type: 'generic', severity: 'warn', fragment: 'La busqueda web no estuvo disponible. La lectura utiliza el contexto previamente guardado y analisis del rol.' });
  if (input.researchWarnings?.includes('conflicting_source_figures')) issues.push({ section: 'company', paragraphIndex: null, type: 'generic', severity: 'warn', fragment: 'Las fuentes contienen cifras diferentes; confirma el alcance antes de dimensionar una propuesta.' });
  for (const warning of [PUBLIC_COMPANY_COVERAGE_LIMITATION, PUBLIC_COMPANY_EXTERNAL_MISSING]) {
    if (input.researchWarnings?.includes(warning)) issues.push({ section: 'sources', paragraphIndex: null, type: 'generic', severity: 'warn', fragment: warning === PUBLIC_COMPANY_EXTERNAL_MISSING ? 'La investigacion corporativa se limita al sitio oficial; las fuentes del contacto se revisan por separado.' : warning });
  }
  const document = validateReportV2({
    kind: 'research_report_document', schemaVersion: 'research-report-document/v2',
    id: `report-v2:${canonicalSha256({ snapshot: input.researchSnapshotId, promptVersion, context: input.synthesisContextHash || null }).slice(0, 24)}`,
    revision: Math.max(1, Math.trunc(input.revision || 1)), researchSnapshotId: input.researchSnapshotId,
    ...(input.publicCompanyResearch ? { publicCompanyResearch: {
      artifactId: input.publicCompanyResearch.artifactId, revision: input.publicCompanyResearch.revision, expiresAt: input.publicCompanyResearch.expiresAt,
    } } : {}),
    scope: input.scope, language: input.language, entity: input.entity, qualification: input.qualification,
    evidenceGraph: { sources: input.sources, facts: input.facts, claims, signals: deliveredSignals, gaps, assumptions, estimates, deliverables: [],
      shortIdMap: Object.fromEntries(Object.entries(input.shortIdMap).filter(([id]) => !withheld.has(id))) },
    analysis, sections, coverage, audit: { status: issues.length ? 'warning' : 'passed', model: review.model, issues },
    synthesis: { status: coverage.missing.length || removedContent ? 'partial' : 'completed', provider: 'openai', promptVersion, generatedAt, acceptedModelBySection },
  });
  return {
    document,
    metrics: { ...reportV2OperationalMetrics({ sectionsAttempted: 6, sectionsAccepted: coverage.filled.length, ...input, claims, sections, signals: deliveredSignals, modelTelemetry }), research: input.researchMetrics },
    // Missing optional evidence is not a reason to repeatedly charge for the same report.
    metadata: { retryable: false, errorCode: removedContent ? 'report_v2_content_withheld' : null, errorMessage: removedContent ? 'Some unsupported content was removed by review.' : null },
  };
}
