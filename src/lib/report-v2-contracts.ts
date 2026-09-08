import { z } from 'zod';

export const REPORT_V2_SCHEMA_VERSION = 'research-report-document/v2' as const;

const text = z.string().trim().min(1);
const nullableInstant = z.string().datetime({ offset: true }).nullable();
const jurisdiction = z.enum(['CL', 'PE', 'CO', 'GLOBAL']).nullable();
const confidence = z.number().finite().min(0).max(1);

function uniqueIds(prefix: RegExp, minimum = 0) {
  return z.array(z.string().regex(prefix)).min(minimum).superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate reference: ${value}`, path: [index] });
      }
      seen.add(value);
    });
  });
}

export const ReportV2SectionKeySchema = z.enum([
  'verdict',
  'snapshot',
  'contact',
  'committee',
  'company',
  'volume',
  'regulatory',
  'signals',
  'fit',
  'angle',
  'discovery',
  'objections',
  'risks',
  'gaps',
  'sources',
]);

export const ClaimTypeV2Schema = z.enum(['fact', 'derived', 'hypothesis', 'declared']);
export const ClaimDimensionV2Schema = z.enum([
  'contact_role',
  'contact_tenure',
  'contact_authority',
  'company_overview',
  'company_industry',
  'company_service',
  'company_size',
  'company_geography',
  'company_legal_form',
  'company_tech',
  'buying_committee',
  'signal',
  'regulatory',
  'volume_estimate',
  'competitor',
  'risk',
]);

const cleanStatement = z.string().trim().min(1).max(220).superRefine((value, ctx) => {
  if (/[<>]|wp-content|elementor|hummingbird|https?:\/\//i.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Claim statement contains markup, an asset path, or a URL' });
  }
});

export const AssumptionV2Schema = z.object({
  id: z.string().regex(/^asm_[a-f0-9]{10}$/),
  label: text.max(160),
  value: z.union([z.number().finite(), text.max(300)]),
  rationale: text.max(1_000),
  editable: z.boolean(),
}).strict();

const claimBase = {
  id: z.string().regex(/^c\d{2,4}$/),
  internalId: text.max(256).nullable(),
  dimension: ClaimDimensionV2Schema,
  statement: cleanStatement,
  freshnessDays: z.number().int().nonnegative().nullable(),
  jurisdiction,
  confidence,
};

export const FactClaimV2Schema = z.object({
  ...claimBase,
  type: z.literal('fact'),
  evidenceIds: uniqueIds(/^f_[a-f0-9]{10}$/, 1),
  observedAt: z.string().datetime({ offset: true }),
}).strict();

export const DerivedClaimV2Schema = z.object({
  ...claimBase,
  type: z.literal('derived'),
  evidenceIds: uniqueIds(/^f_[a-f0-9]{10}$/),
  observedAt: nullableInstant,
  inputs: uniqueIds(/^c\d{2,4}$/, 1),
  assumptions: z.array(AssumptionV2Schema).min(1).max(20),
  formula: text.max(500),
}).strict();

export const HypothesisClaimV2Schema = z.object({
  ...claimBase,
  type: z.literal('hypothesis'),
  evidenceIds: uniqueIds(/^f_[a-f0-9]{10}$/),
  observedAt: nullableInstant,
  validationQuestion: z.string().trim().min(2).max(500).endsWith('?'),
}).strict();

export const DeclaredClaimV2Schema = z.object({
  ...claimBase,
  type: z.literal('declared'),
  evidenceIds: z.tuple([]),
  observedAt: nullableInstant,
}).strict();

export const ClaimV2Schema = z.discriminatedUnion('type', [
  FactClaimV2Schema,
  DerivedClaimV2Schema,
  HypothesisClaimV2Schema,
  DeclaredClaimV2Schema,
]);

export const SourceV2Schema = z.object({
  id: z.string().regex(/^src_[a-f0-9]{10}$/),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  title: text.max(500),
  sourceType: z.enum(['corporate', 'press', 'registry', 'industry', 'organization', 'social', 'search', 'other']),
  jurisdiction,
  publishedAt: nullableInstant,
  modifiedAt: nullableInstant,
  retrievedAt: z.string().datetime({ offset: true }),
  ownDomain: z.boolean(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const FactV2Schema = z.object({
  id: z.string().regex(/^f_[a-f0-9]{10}$/),
  sourceId: z.string().regex(/^src_[a-f0-9]{10}$/),
  text: text.max(2_000),
  observedAt: nullableInstant,
  jurisdiction,
  locator: text.max(500).nullable(),
}).strict();

export const SignalV2Schema = z.object({
  id: z.string().regex(/^sig_[a-f0-9]{10}$/),
  claimId: z.string().regex(/^c\d{2,4}$/),
  signalType: z.enum(['press', 'hiring', 'leadership', 'award', 'expansion', 'technology', 'regulatory', 'industry']),
  observedAt: z.string().datetime({ offset: true }),
  freshnessDays: z.number().int().nonnegative().nullable(),
}).strict();

export const GapV2Schema = z.object({
  id: z.string().regex(/^gap_[a-f0-9]{10}$/),
  section: ReportV2SectionKeySchema,
  requiredField: text.max(200),
  unknown: text.max(500),
  howToFind: text.max(1_000),
  source: text.max(500),
}).strict();

export const EstimateV2Schema = z.object({
  id: z.string().regex(/^est_[a-f0-9]{10}$/),
  label: text.max(200),
  value: z.number().finite(),
  unit: text.max(80),
  inputClaimIds: uniqueIds(/^c\d{2,4}$/, 1),
  assumptionIds: uniqueIds(/^asm_[a-f0-9]{10}$/, 1),
  formula: text.max(500),
}).strict();

export const DeliverableV2Schema = z.object({
  id: z.string().regex(/^del_[a-f0-9]{10}$/),
  kind: z.enum(['email', 'call_script', 'discovery_plan', 'redirect_plan']),
  status: z.enum(['ready', 'needs_review', 'blocked']),
  content: text.max(10_000),
  claimIds: uniqueIds(/^c\d{2,4}$/),
}).strict();

export const EntityResolutionV2Schema = z.object({
  companyName: text.max(300),
  companyDomain: text.max(300),
  contactCountry: z.enum(['CL', 'PE', 'CO', 'OTHER']),
  operatingCountries: z.array(text.max(120)).max(100),
  countryScopedPaths: z.record(text.max(500)),
  excludedPaths: z.array(text.max(500)).max(100),
  contact: z.object({
    fullName: text.max(300),
    title: text.max(1_000),
    seniority: z.enum(['c_suite', 'vp', 'director', 'head', 'manager', 'coordinator', 'ic', 'unknown']),
    department: text.max(300),
    tenureMonths: z.number().int().nonnegative().nullable(),
    companyTenureMonths: z.number().int().nonnegative().nullable(),
    linkedinUrl: z.string().url().nullable(),
  }).strict(),
  ambiguities: z.array(text.max(1_000)).max(50),
}).strict();

export const QualificationVerdictV2Schema = z.enum([
  'qualified',
  'disqualified_role',
  'disqualified_jurisdiction',
  'disqualified_size',
  'account_qualified_contact_rejected',
]);

export const QualificationV2Schema = z.object({
  verdict: QualificationVerdictV2Schema,
  reasons: z.array(text.max(1_000)).max(30),
  redirectTo: z.array(z.object({
    title: text.max(300),
    seniority: text.max(100),
    rationale: text.max(1_000),
  }).strict()).max(20),
  allowedDepth: z.enum(['skip', 'shallow', 'deep']),
}).strict();

export const CommitteeMemberV2Schema = z.object({
  name: text.max(300).nullable(),
  title: text.max(300),
  rank: z.enum(['primary', 'alternative', 'third', 'rejected']),
  rationale: text.max(1_000),
  emailStatus: z.enum(['verified', 'unverified', 'not_found', 'not_searched']),
  linkedinUrl: z.string().url().nullable(),
  claimIds: uniqueIds(/^c\d{2,4}$/),
}).strict();

export const VolumeModelV2Schema = z.object({
  baseClaimId: z.string().regex(/^c\d{2,4}$/),
  assumptions: z.array(AssumptionV2Schema).min(1).max(20),
  scenarios: z.array(z.object({
    label: text.max(100),
    multiplier: z.number().finite().positive(),
    eventsPerYear: z.number().finite().nonnegative(),
    eventsPerMonth: z.number().finite().nonnegative(),
    hoursPerMonth: z.number().finite().nonnegative(),
  }).strict()).length(3),
  baseScenarioIndex: z.number().int().min(0).max(2),
  caveats: z.array(text.max(1_000)).max(20),
}).strict();

export const ProductFitV2Schema = z.object({
  productKey: text.max(160),
  verdict: z.enum(['strong', 'possible', 'weak', 'disqualified']),
  rationale: text.max(2_000),
  claimIds: uniqueIds(/^c\d{2,4}$/),
  headquartersContextClaimIds: uniqueIds(/^c\d{2,4}$/),
  validationQuestion: z.string().trim().min(2).max(500).endsWith('?').nullable(),
}).strict();

export const AnalysisV2Schema = z.object({
  verdict: z.object({
    headline: text.max(500),
    qualification: QualificationVerdictV2Schema,
    recommendedProduct: text.max(160),
    nextAction: text.max(1_000),
    blockers: z.array(text.max(500)).max(20),
  }).strict(),
  buyingCommittee: z.array(CommitteeMemberV2Schema).max(50),
  volumeModel: VolumeModelV2Schema.nullable(),
  signalIds: uniqueIds(/^sig_[a-f0-9]{10}$/),
  fitByProduct: z.array(ProductFitV2Schema).max(50),
  entryAngle: z.object({
    channel: text.max(100),
    timing: text.max(500),
    hooks: z.array(text.max(500)).max(20),
  }).strict(),
  discoveryQuestions: z.array(z.object({
    question: z.string().trim().min(2).max(500).endsWith('?'),
    validatesClaimId: z.string().regex(/^c\d{2,4}$/),
  }).strict()).max(30),
  objections: z.array(z.object({
    objection: text.max(500),
    derivedFrom: uniqueIds(/^c\d{2,4}$/, 1),
    response: text.max(1_000),
  }).strict()).max(30),
  riskClaimIds: uniqueIds(/^c\d{2,4}$/),
  gapIds: uniqueIds(/^gap_[a-f0-9]{10}$/),
}).strict();

export const SectionParagraphV2Schema = z.object({
  text: text.max(2_000),
  claimIds: uniqueIds(/^c\d{2,4}$/),
  context: z.enum(['target', 'headquarters']).default('target'),
}).strict();

export const SectionBlockV2Schema = z.object({
  type: z.enum(['facts', 'table', 'committee', 'timeline', 'questions', 'sources', 'deliverable', 'gaps']),
  title: text.max(300).nullable(),
  claimIds: uniqueIds(/^c\d{2,4}$/),
  payload: z.unknown(),
}).strict();

export const SectionV2Schema = z.object({
  key: ReportV2SectionKeySchema,
  title: text.max(300),
  paragraphs: z.array(SectionParagraphV2Schema).max(20),
  blocks: z.array(SectionBlockV2Schema).max(20),
}).strict();

export const EvidenceGraphV2Schema = z.object({
  sources: z.array(SourceV2Schema).max(200),
  facts: z.array(FactV2Schema).max(1_000),
  claims: z.array(ClaimV2Schema).max(1_000),
  signals: z.array(SignalV2Schema).max(200),
  gaps: z.array(GapV2Schema).max(200),
  assumptions: z.array(AssumptionV2Schema).max(200),
  estimates: z.array(EstimateV2Schema).max(200),
  deliverables: z.array(DeliverableV2Schema).max(100),
  shortIdMap: z.record(text.max(256).nullable()),
}).strict();

export const ReportV2Schema = z.object({
  kind: z.literal('research_report_document'),
  schemaVersion: z.literal(REPORT_V2_SCHEMA_VERSION),
  id: text.max(256),
  revision: z.number().int().positive(),
  researchSnapshotId: text.max(256),
  scope: z.object({
    organizationId: text.max(256),
    ownerUserId: text.max(256),
  }).strict(),
  language: z.string().trim().min(2).max(12),
  entity: EntityResolutionV2Schema,
  qualification: QualificationV2Schema,
  evidenceGraph: EvidenceGraphV2Schema,
  analysis: AnalysisV2Schema,
  sections: z.array(SectionV2Schema).length(15),
  coverage: z.object({
    ratio: z.number().finite().min(0).max(1),
    filled: z.array(text.max(200)),
    missing: z.array(text.max(200)),
  }).strict(),
  audit: z.object({
    status: z.enum(['passed', 'warning']),
    model: text.max(160),
    issues: z.array(z.object({
      section: ReportV2SectionKeySchema,
      paragraphIndex: z.number().int().nonnegative().nullable(),
      type: z.enum(['duplication', 'truncated', 'technical_noise', 'literal_copy', 'invalid_citation', 'jurisdiction', 'hard_hypothesis', 'generic']),
      fragment: text.max(1_000),
      severity: z.enum(['block', 'warn']),
    }).strict()).max(200),
  }).strict(),
  synthesis: z.object({
    status: z.enum(['completed', 'partial']),
    provider: z.literal('openai'),
    promptVersion: text.max(160),
    generatedAt: z.string().datetime({ offset: true }),
    acceptedModelBySection: z.record(text.max(160)),
  }).strict(),
}).strict();

export type AssumptionV2 = z.infer<typeof AssumptionV2Schema>;
export type ClaimV2 = z.infer<typeof ClaimV2Schema>;
export type FactV2 = z.infer<typeof FactV2Schema>;
export type SourceV2 = z.infer<typeof SourceV2Schema>;
export type SignalV2 = z.infer<typeof SignalV2Schema>;
export type GapV2 = z.infer<typeof GapV2Schema>;
export type EstimateV2 = z.infer<typeof EstimateV2Schema>;
export type DeliverableV2 = z.infer<typeof DeliverableV2Schema>;
export type EntityResolutionV2 = z.infer<typeof EntityResolutionV2Schema>;
export type QualificationV2 = z.infer<typeof QualificationV2Schema>;
export type CommitteeMemberV2 = z.infer<typeof CommitteeMemberV2Schema>;
export type VolumeModelV2 = z.infer<typeof VolumeModelV2Schema>;
export type AnalysisV2 = z.infer<typeof AnalysisV2Schema>;
export type SectionV2 = z.infer<typeof SectionV2Schema>;
export type EvidenceGraphV2 = z.infer<typeof EvidenceGraphV2Schema>;
export type ReportV2 = z.infer<typeof ReportV2Schema>;
export type ReportV2SectionKey = z.infer<typeof ReportV2SectionKeySchema>;

export function assignShortClaimIds<T extends { internalId?: string | null }>(claims: T[]) {
  const width = Math.max(2, String(claims.length).length);
  const shortIdMap: Record<string, string | null> = {};
  const values = claims.map((claim, index) => {
    const id = `c${String(index + 1).padStart(width, '0')}`;
    shortIdMap[id] = claim.internalId || null;
    return { ...claim, id };
  });
  return { claims: values, shortIdMap };
}

function duplicateIssues(values: string[], label: string) {
  const seen = new Set<string>();
  const issues: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) issues.push(`duplicate_${label}:${value}`);
    seen.add(value);
  });
  return issues;
}

export function collectReportV2IntegrityIssues(report: ReportV2): string[] {
  const graph = report.evidenceGraph;
  const sourceIds = new Set(graph.sources.map((item) => item.id));
  const factIds = new Set(graph.facts.map((item) => item.id));
  const claimsById = new Map(graph.claims.map((item) => [item.id, item]));
  const signalIds = new Set(graph.signals.map((item) => item.id));
  const gapIds = new Set(graph.gaps.map((item) => item.id));
  const assumptionIds = new Set(graph.assumptions.map((item) => item.id));
  const deliverableIds = new Set(graph.deliverables.map((item) => item.id));
  const issues = [
    ...duplicateIssues(graph.sources.map((item) => item.id), 'source_id'),
    ...duplicateIssues(graph.facts.map((item) => item.id), 'fact_id'),
    ...duplicateIssues(graph.claims.map((item) => item.id), 'claim_id'),
    ...duplicateIssues(graph.signals.map((item) => item.id), 'signal_id'),
    ...duplicateIssues(graph.gaps.map((item) => item.id), 'gap_id'),
  ];
  const expectedSections = ReportV2SectionKeySchema.options;
  const sectionKeys = report.sections.map((section) => section.key);
  issues.push(...duplicateIssues(sectionKeys, 'section'));
  expectedSections.forEach((key) => {
    if (!sectionKeys.includes(key)) issues.push(`missing_section:${key}`);
  });

  graph.facts.forEach((fact) => {
    if (!sourceIds.has(fact.sourceId)) issues.push(`fact_source_missing:${fact.id}:${fact.sourceId}`);
  });
  graph.claims.forEach((claim) => {
    claim.evidenceIds.forEach((id) => {
      if (!factIds.has(id)) issues.push(`claim_evidence_missing:${claim.id}:${id}`);
    });
    if (claim.type === 'derived') {
      claim.inputs.forEach((id) => {
        if (!claimsById.has(id)) issues.push(`claim_input_missing:${claim.id}:${id}`);
      });
    }
  });
  graph.signals.forEach((signal) => {
    const claim = claimsById.get(signal.claimId);
    if (!claim || claim.type !== 'fact' || claim.dimension !== 'signal') {
      issues.push(`signal_claim_invalid:${signal.id}:${signal.claimId}`);
    }
  });
  graph.estimates.forEach((estimate) => {
    estimate.inputClaimIds.forEach((id) => {
      if (!claimsById.has(id)) issues.push(`estimate_input_missing:${estimate.id}:${id}`);
    });
    estimate.assumptionIds.forEach((id) => {
      if (!assumptionIds.has(id)) issues.push(`estimate_assumption_missing:${estimate.id}:${id}`);
    });
  });
  graph.deliverables.forEach((deliverable) => {
    deliverable.claimIds.forEach((id) => {
      if (!claimsById.has(id)) issues.push(`deliverable_claim_missing:${deliverable.id}:${id}`);
    });
  });
  Object.entries(graph.shortIdMap).forEach(([shortId, internalId]) => {
    const claim = claimsById.get(shortId);
    if (!claim) issues.push(`short_id_claim_missing:${shortId}`);
    if (internalId && !internalId.trim()) issues.push(`short_id_internal_invalid:${shortId}`);
    if (claim && claim.internalId !== internalId) issues.push(`short_id_internal_mismatch:${shortId}`);
  });
  graph.claims.forEach((claim) => {
    if (!(claim.id in graph.shortIdMap)) issues.push(`claim_short_id_missing:${claim.id}`);
  });

  report.sections.forEach((section) => {
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.claimIds.forEach((id) => {
        const claim = claimsById.get(id);
        if (!claim) issues.push(`section_claim_missing:${section.key}:${paragraphIndex}:${id}`);
        if (
          section.key === 'fit'
          && paragraph.context !== 'headquarters'
          && claim?.jurisdiction
          && claim.jurisdiction !== 'GLOBAL'
          && claim.jurisdiction !== report.entity.contactCountry
        ) issues.push(`fit_jurisdiction_mismatch:${paragraphIndex}:${id}`);
      });
    });
    section.blocks.forEach((block, blockIndex) => {
      block.claimIds.forEach((id) => {
        if (!claimsById.has(id)) issues.push(`section_block_claim_missing:${section.key}:${blockIndex}:${id}`);
      });
      if (block.type === 'deliverable' && typeof block.payload === 'string' && !deliverableIds.has(block.payload)) {
        issues.push(`section_deliverable_missing:${section.key}:${block.payload}`);
      }
    });
  });

  report.analysis.signalIds.forEach((id) => {
    if (!signalIds.has(id)) issues.push(`analysis_signal_missing:${id}`);
  });
  report.analysis.gapIds.forEach((id) => {
    if (!gapIds.has(id)) issues.push(`analysis_gap_missing:${id}`);
  });
  report.analysis.volumeModel?.assumptions.forEach((assumption) => {
    if (!assumptionIds.has(assumption.id)) issues.push(`volume_assumption_missing:${assumption.id}`);
  });
  if (report.analysis.volumeModel) {
    const base = claimsById.get(report.analysis.volumeModel.baseClaimId);
    if (!base || base.type !== 'fact') issues.push(`volume_base_claim_invalid:${report.analysis.volumeModel.baseClaimId}`);
  }
  report.analysis.fitByProduct.forEach((fit, fitIndex) => {
    const headquarters = new Set(fit.headquartersContextClaimIds);
    fit.claimIds.forEach((id) => {
      const claim = claimsById.get(id);
      if (!claim) issues.push(`fit_claim_missing:${fitIndex}:${id}`);
      else if (
        claim.jurisdiction
        && claim.jurisdiction !== 'GLOBAL'
        && claim.jurisdiction !== report.entity.contactCountry
        && !headquarters.has(id)
      ) issues.push(`fit_claim_jurisdiction_mismatch:${fitIndex}:${id}`);
    });
  });
  if (report.audit.issues.some((issue) => issue.severity === 'block')) issues.push('audit_has_blocking_issues');
  return issues;
}

export class ReportV2IntegrityError extends Error {
  constructor(readonly issues: string[]) {
    super(`REPORT_V2_INTEGRITY_INVALID:${issues.join(';')}`);
    this.name = 'ReportV2IntegrityError';
  }
}

export function validateReportV2(value: unknown): ReportV2 {
  const report = ReportV2Schema.parse(value);
  const issues = collectReportV2IntegrityIssues(report);
  if (issues.length > 0) throw new ReportV2IntegrityError(issues);
  return report;
}
