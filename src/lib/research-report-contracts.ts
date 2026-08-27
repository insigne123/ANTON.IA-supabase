import { z } from 'zod';

import {
  ResearchSnapshotV1Schema,
  type ResearchClaimV1,
  type ResearchSnapshotV1,
} from '@/lib/research-contracts';

const nonEmptyText = z.string().trim().min(1).max(4_000);
const identifier = z.string().trim().min(1).max(256);
const uniqueIdentifiers = z.array(identifier).min(1).max(20).superRefine((values, ctx) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate reference: ${value}`, path: [index] });
    }
    seen.add(value);
  });
});

export const ResearchReportSectionV1Schema = z.enum([
  'person_verified',
  'company_overview',
  'company_offerings',
  'company_market',
  'company_scale',
  'signals',
  'commercial_hypotheses',
  'outreach',
]);

export const ResearchReportCitationV1Schema = z.object({
  claimIds: uniqueIdentifiers,
  evidenceIds: uniqueIdentifiers,
}).strict();

export const ResearchReportFactualBlockV1Schema = z.object({
  id: identifier,
  classification: z.literal('fact'),
  subjectScope: z.enum(['company', 'person']),
  statement: nonEmptyText,
  citations: ResearchReportCitationV1Schema,
}).strict();

export const ResearchReportHypothesisBlockV1Schema = z.object({
  id: identifier,
  classification: z.literal('hypothesis'),
  subjectScope: z.enum(['company', 'person']),
  statement: nonEmptyText,
  citations: ResearchReportCitationV1Schema,
}).strict();

export const ResearchReportSignalV1Schema = ResearchReportFactualBlockV1Schema.extend({
  signalType: z.enum(['news', 'hiring', 'technology', 'site']),
  observedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const ResearchReportImportedPersonContextV1Schema = z.object({
  provenance: z.literal('imported'),
  fullName: z.string().trim().min(1).max(300).nullable(),
  title: z.string().trim().min(1).max(2_000).nullable(),
  linkedinUrl: z.string().url().nullable(),
  city: z.string().trim().min(1).max(2_000).nullable(),
  country: z.string().trim().min(1).max(2_000).nullable(),
}).strict();

export const ResearchReportGapV1Schema = z.object({
  id: identifier,
  section: ResearchReportSectionV1Schema,
  description: nonEmptyText,
}).strict();

export const ResearchReportContradictionV1Schema = z.object({
  id: identifier,
  contradictionId: identifier,
  summary: nonEmptyText,
  status: z.enum(['unresolved', 'resolved']),
  citations: ResearchReportCitationV1Schema,
}).strict();

const reportFactList = z.array(ResearchReportFactualBlockV1Schema).max(20);
const reportHypothesisList = z.array(ResearchReportHypothesisBlockV1Schema).max(20);

export const ResearchReportNarrativeParagraphV1Schema = z.object({
  text: nonEmptyText,
  claimIds: uniqueIdentifiers,
  evidenceIds: uniqueIdentifiers,
}).strict();

export const ResearchReportNarrativeV1Schema = z.object({
  executiveSummary: z.array(ResearchReportNarrativeParagraphV1Schema).max(2),
  companyProfile: z.array(ResearchReportNarrativeParagraphV1Schema).max(4),
  leadContext: z.array(ResearchReportNarrativeParagraphV1Schema).max(2),
  commercialReading: z.array(ResearchReportNarrativeParagraphV1Schema).max(3),
}).strict();

export const ResearchReportSynthesisOutputV1Schema = z.object({
  executiveSummary: z.object({ facts: reportFactList }).strict(),
  person: z.object({ verifiedFacts: reportFactList }).strict(),
  company: z.object({
    overview: reportFactList,
    offerings: reportFactList,
    market: reportFactList,
    scale: reportFactList,
  }).strict(),
  signals: z.array(ResearchReportSignalV1Schema).max(20),
  commercialHypotheses: reportHypothesisList,
  outreachBrief: z.object({
    factualAnchors: reportFactList,
    hypotheses: reportHypothesisList,
    doNotClaim: z.array(nonEmptyText).max(20),
  }).strict(),
}).strict();

const completenessSchema = z.object({
  status: z.enum(['complete', 'partial']),
  score: z.number().finite().min(0).max(1),
  coveredSections: z.array(ResearchReportSectionV1Schema).max(8),
  missingSections: z.array(ResearchReportSectionV1Schema).max(8),
}).strict().superRefine((value, ctx) => {
  const allSections = ResearchReportSectionV1Schema.options;
  const covered = new Set(value.coveredSections);
  const missing = new Set(value.missingSections);
  if (covered.size !== value.coveredSections.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Covered sections must be unique', path: ['coveredSections'] });
  }
  if (missing.size !== value.missingSections.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Missing sections must be unique', path: ['missingSections'] });
  }
  allSections.forEach((section) => {
    if (covered.has(section) === missing.has(section)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Section ${section} must appear in exactly one completeness list`,
        path: ['missingSections'],
      });
    }
  });
  if ((value.missingSections.length === 0) !== (value.status === 'complete')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Completeness status must match missing sections', path: ['status'] });
  }
  const expectedScore = value.coveredSections.length / allSections.length;
  if (Math.abs(value.score - expectedScore) > 1e-9) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Completeness score must match covered sections', path: ['score'] });
  }
});

export const ResearchReportDocumentV1Schema = z.object({
  kind: z.literal('research_report_document'),
  schemaVersion: z.literal('research-report-document/v1'),
  id: identifier,
  revision: z.literal(1),
  researchSnapshotId: identifier,
  scope: z.object({
    organizationId: identifier,
    ownerUserId: identifier,
  }).strict(),
  language: z.string().trim().min(2).max(12),
  executiveSummary: z.object({ facts: reportFactList }).strict(),
  person: z.object({
    importedContext: ResearchReportImportedPersonContextV1Schema,
    verifiedFacts: reportFactList,
  }).strict(),
  company: z.object({
    overview: reportFactList,
    offerings: reportFactList,
    market: reportFactList,
    scale: reportFactList,
  }).strict(),
  signals: z.array(ResearchReportSignalV1Schema).max(20),
  commercialHypotheses: reportHypothesisList,
  gaps: z.array(ResearchReportGapV1Schema).max(20),
  contradictions: z.array(ResearchReportContradictionV1Schema).max(20),
  narrative: ResearchReportNarrativeV1Schema.optional(),
  outreachBrief: z.object({
    factualAnchors: reportFactList,
    hypotheses: reportHypothesisList,
    doNotClaim: z.array(nonEmptyText).max(20),
  }).strict(),
  completeness: completenessSchema,
  synthesis: z.object({
    status: z.enum(['completed', 'partial']),
    method: z.enum(['model', 'fallback']),
    provider: z.literal('openai'),
    model: z.string().trim().min(1).max(160).nullable(),
    promptVersion: z.string().trim().min(1).max(160),
    generatedAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict().superRefine((document, ctx) => {
  if (document.synthesis.method === 'fallback' && document.synthesis.status !== 'partial') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Fallback reports must remain explicitly partial',
      path: ['synthesis', 'status'],
    });
  }
  if (document.synthesis.status === 'completed' && document.completeness.status !== 'complete') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Completed synthesis requires complete report coverage',
      path: ['synthesis', 'status'],
    });
  }
  const missing = new Set(document.completeness.missingSections);
  document.gaps.forEach((gap, index) => {
    if (!missing.has(gap.section)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Gap section is not marked missing', path: ['gaps', index, 'section'] });
    }
  });
  document.completeness.missingSections.forEach((section) => {
    if (!document.gaps.some((gap) => gap.section === section)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing section ${section} requires a gap`, path: ['gaps'] });
    }
  });
});

export type ResearchReportSectionV1 = z.infer<typeof ResearchReportSectionV1Schema>;
export type ResearchReportCitationV1 = z.infer<typeof ResearchReportCitationV1Schema>;
export type ResearchReportFactualBlockV1 = z.infer<typeof ResearchReportFactualBlockV1Schema>;
export type ResearchReportHypothesisBlockV1 = z.infer<typeof ResearchReportHypothesisBlockV1Schema>;
export type ResearchReportSynthesisOutputV1 = z.infer<typeof ResearchReportSynthesisOutputV1Schema>;
export type ResearchReportNarrativeParagraphV1 = z.infer<typeof ResearchReportNarrativeParagraphV1Schema>;
export type ResearchReportNarrativeV1 = z.infer<typeof ResearchReportNarrativeV1Schema>;
export type ResearchReportDocumentV1 = z.infer<typeof ResearchReportDocumentV1Schema>;

export class ResearchReportCitationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`RESEARCH_REPORT_CITATIONS_INVALID:${issues.join('; ')}`);
    this.name = 'ResearchReportCitationError';
    this.issues = issues;
  }
}

function importedPersonContext(snapshot: ResearchSnapshotV1) {
  return {
    provenance: 'imported' as const,
    fullName: snapshot.subject.person.fullName || null,
    title: snapshot.subject.person.title || null,
    linkedinUrl: snapshot.subject.person.linkedinUrl || null,
    city: snapshot.subject.person.city || null,
    country: snapshot.subject.person.country || null,
  };
}

function sameStringSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function normalizedStatement(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedInstant(value: string | null) {
  return value ? new Date(value).toISOString() : null;
}

function signalTypeForClaimKind(kind: ResearchClaimV1['kind']) {
  if (kind === 'news_signal') return 'news' as const;
  if (kind === 'hiring_signal') return 'hiring' as const;
  if (kind === 'technology_signal') return 'technology' as const;
  if (kind === 'site_signal') return 'site' as const;
  return null;
}

export function validateResearchReportDocumentCitationsV1(
  documentInput: unknown,
  snapshotInput: unknown,
): ResearchReportDocumentV1 {
  const snapshot = ResearchSnapshotV1Schema.parse(snapshotInput);
  const document = ResearchReportDocumentV1Schema.parse(documentInput);
  const issues: string[] = [];

  if (document.researchSnapshotId !== snapshot.id) issues.push('document references a different research snapshot');
  if (document.scope.organizationId !== snapshot.scope.organizationId) issues.push('document organization scope does not match the snapshot');
  if (document.scope.ownerUserId !== snapshot.scope.ownerUserId) issues.push('document owner scope does not match the snapshot');
  if (document.language !== snapshot.request.language) issues.push('document language does not match the snapshot request');
  if (JSON.stringify(document.person.importedContext) !== JSON.stringify(importedPersonContext(snapshot))) {
    issues.push('imported person context must be copied exactly from the snapshot subject');
  }

  const claimsById = new Map(snapshot.claims.map((claim) => [claim.id, claim]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const seenBlockIds = new Set<string>();
  const signalKinds = new Set<ResearchClaimV1['kind']>(['news_signal', 'hiring_signal', 'technology_signal', 'site_signal']);

  const validateBlock = (
    block: ResearchReportFactualBlockV1 | ResearchReportHypothesisBlockV1,
    path: string,
    expectedClassification: ResearchClaimV1['classification'],
    expectedScope?: ResearchClaimV1['subjectScope'],
    allowedKinds?: Set<ResearchClaimV1['kind']>,
  ) => {
    if (seenBlockIds.has(block.id)) issues.push(`${path} reuses block ID ${block.id}`);
    seenBlockIds.add(block.id);
    const citedClaims = block.citations.claimIds.flatMap((claimId) => {
      const claim = claimsById.get(claimId);
      if (!claim) {
        issues.push(`${path} references unknown claim ${claimId}`);
        return [];
      }
      if (claim.classification !== expectedClassification) {
        issues.push(`${path} cites ${claim.classification} claim ${claimId} as ${expectedClassification}`);
      }
      if (claim.subjectScope !== block.subjectScope || (expectedScope && claim.subjectScope !== expectedScope)) {
        issues.push(`${path} cites claim ${claimId} from the wrong subject scope`);
      }
      if (allowedKinds && !allowedKinds.has(claim.kind)) issues.push(`${path} cites claim ${claimId} with a kind not allowed in this section`);
      return [claim];
    });
    block.citations.evidenceIds.forEach((evidenceId) => {
      if (!evidenceById.has(evidenceId)) {
        issues.push(`${path} references unknown evidence ${evidenceId}`);
        return;
      }
      if (!citedClaims.some((claim) => claim.supportingEvidenceIds.includes(evidenceId))) {
        issues.push(`${path} evidence ${evidenceId} is not supporting evidence for a cited claim`);
      }
    });
    citedClaims.forEach((claim) => {
      if (!block.citations.evidenceIds.some((evidenceId) => claim.supportingEvidenceIds.includes(evidenceId))) {
        issues.push(`${path} claim ${claim.id} has no cited canonical supporting evidence`);
      }
    });
    if (!citedClaims.some((claim) => normalizedStatement(claim.statement) === normalizedStatement(block.statement))) {
      issues.push(`${path} statement does not match a cited canonical claim statement`);
    }
    return citedClaims;
  };

  document.executiveSummary.facts.forEach((block, index) => validateBlock(block, `executiveSummary.facts.${index}`, 'fact'));
  document.person.verifiedFacts.forEach((block, index) => validateBlock(block, `person.verifiedFacts.${index}`, 'fact', 'person'));
  const companySectionKinds = {
    overview: new Set<ResearchClaimV1['kind']>(['company_overview', 'company_identity', 'company_priority']),
    offerings: new Set<ResearchClaimV1['kind']>(['company_service']),
    market: new Set<ResearchClaimV1['kind']>(['company_industry']),
    scale: new Set<ResearchClaimV1['kind']>(['company_size']),
  };
  (['overview', 'offerings', 'market', 'scale'] as const).forEach((section) => {
    document.company[section].forEach((block, index) => validateBlock(
      block,
      `company.${section}.${index}`,
      'fact',
      'company',
      companySectionKinds[section],
    ));
  });
  document.signals.forEach((block, index) => {
    const path = `signals.${index}`;
    const citedClaims = validateBlock(block, path, 'fact', undefined, signalKinds);
    const expectedTypes = citedClaims.map((claim) => signalTypeForClaimKind(claim.kind)).filter(Boolean);
    if (expectedTypes.some((signalType) => signalType !== block.signalType)) {
      issues.push(`${path} signalType does not match its cited canonical signal claim`);
    }
    const citedEvidence = block.citations.evidenceIds
      .map((evidenceId) => evidenceById.get(evidenceId))
      .find((evidence) => evidence && citedClaims.some((claim) => claim.supportingEvidenceIds.includes(evidence.id)));
    const source = citedEvidence ? sourceById.get(citedEvidence.sourceId) : null;
    const expectedObservedAt = citedEvidence?.observedAt || source?.publishedAt || source?.retrievedAt || null;
    if (normalizedInstant(block.observedAt) !== normalizedInstant(expectedObservedAt)) {
      issues.push(`${path} observedAt does not match the cited canonical evidence/source date`);
    }
  });
  document.commercialHypotheses.forEach((block, index) => validateBlock(block, `commercialHypotheses.${index}`, 'hypothesis'));
  document.outreachBrief.factualAnchors.forEach((block, index) => validateBlock(block, `outreachBrief.factualAnchors.${index}`, 'fact'));
  document.outreachBrief.hypotheses.forEach((block, index) => validateBlock(block, `outreachBrief.hypotheses.${index}`, 'hypothesis'));

  if (document.narrative) {
    const companyNarrativeKinds = new Set<ResearchClaimV1['kind']>([
      'company_overview', 'company_identity', 'company_industry', 'company_service', 'company_size', 'company_priority',
    ]);
    const commercialNarrativeKinds = new Set<ResearchClaimV1['kind']>([
      'company_priority', 'news_signal', 'hiring_signal', 'technology_signal', 'site_signal',
      'pain_hypothesis', 'opportunity_hypothesis', 'risk_hypothesis', 'use_case_hypothesis',
    ]);
    Object.entries(document.narrative).forEach(([section, paragraphs]) => {
      paragraphs.forEach((paragraph, index) => {
        const citedClaims = paragraph.claimIds.flatMap((claimId) => {
          const claim = claimsById.get(claimId);
          if (!claim) {
            issues.push(`narrative.${section}.${index} references unknown claim ${claimId}`);
            return [];
          }
          const allowed = section === 'companyProfile'
            ? claim.classification === 'fact' && claim.subjectScope === 'company' && companyNarrativeKinds.has(claim.kind)
            : section === 'leadContext'
              ? claim.classification === 'fact' && claim.subjectScope === 'person'
              : section === 'commercialReading'
                ? commercialNarrativeKinds.has(claim.kind)
                : true;
          if (!allowed) issues.push(`narrative.${section}.${index} cites claim ${claimId} from the wrong narrative section`);
          return [claim];
        });
        paragraph.evidenceIds.forEach((evidenceId) => {
          if (!evidenceById.has(evidenceId)) {
            issues.push(`narrative.${section}.${index} references unknown evidence ${evidenceId}`);
          } else if (!citedClaims.some((claim) => claim.supportingEvidenceIds.includes(evidenceId))) {
            issues.push(`narrative.${section}.${index} evidence ${evidenceId} does not support a cited claim`);
          }
        });
        citedClaims.forEach((claim) => {
          if (!paragraph.evidenceIds.some((evidenceId) => claim.supportingEvidenceIds.includes(evidenceId))) {
            issues.push(`narrative.${section}.${index} claim ${claim.id} has no cited canonical supporting evidence`);
          }
        });
      });
    });
  }

  const contradictionsById = new Map(snapshot.contradictions.map((item) => [item.id, item]));
  document.contradictions.forEach((item, index) => {
    if (seenBlockIds.has(item.id)) issues.push(`contradictions.${index} reuses block ID ${item.id}`);
    seenBlockIds.add(item.id);
    const canonical = contradictionsById.get(item.contradictionId);
    if (!canonical) {
      issues.push(`contradictions.${index} references unknown contradiction ${item.contradictionId}`);
      return;
    }
    if (!sameStringSet(item.citations.claimIds, canonical.claimIds)) {
      issues.push(`contradictions.${index} claim references do not match the canonical contradiction`);
    }
    if (!sameStringSet(item.citations.evidenceIds, canonical.evidenceIds)) {
      issues.push(`contradictions.${index} evidence references do not match the canonical contradiction`);
    }
    if (normalizedStatement(item.summary) !== normalizedStatement(canonical.summary)) {
      issues.push(`contradictions.${index} summary does not match the canonical contradiction`);
    }
    if (item.status !== canonical.status) {
      issues.push(`contradictions.${index} status does not match the canonical contradiction`);
    }
  });

  document.gaps.forEach((gap, index) => {
    if (seenBlockIds.has(gap.id)) issues.push(`gaps.${index} reuses block ID ${gap.id}`);
    seenBlockIds.add(gap.id);
  });

  if (issues.length > 0) throw new ResearchReportCitationError(issues);
  return document;
}

export const researchReportContractInternals = { importedPersonContext };
