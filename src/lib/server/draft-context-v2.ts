import { z } from 'zod';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import {
  ResearchSnapshotV1Schema,
  type ResearchSnapshotV1,
} from '@/lib/research-contracts';
import {
  isDraftableCompanyFactClaim,
  isDraftablePersonFactClaim,
  isFreshResearchClaim,
  isQualifiedResearchFactEvidence,
  isQualifiedResearchPersonFactEvidence,
  isRelevantResearchSignal,
} from '@/lib/research-fact-eligibility';
import {
  assessResearchQuality,
  type ResearchQualityAssessment,
} from '@/lib/native-research-quality';

export const DRAFT_CONTEXT_V2_SCHEMA_VERSION = 'draft-context/v2';
export const DRAFT_CONTEXT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_DRAFT_QUALITY_SCORE = 48;

export const DEFAULT_DRAFT_CTA = '¿Te parece una conversación breve de 15 minutos esta semana?';
export const DRAFT_PROHIBITED_PHRASES = [
  'soy una ia',
  'como ia',
  'as an ai',
  'language model',
  '100% garantizado',
  'garantizamos resultados',
] as const;

const NullableTextSchema = z.string().trim().min(1).max(2_000).nullable();
const StringListSchema = z.array(z.string().trim().min(1).max(2_000)).max(50);

export const DraftWritingStyleV2Schema = z.object({
  id: z.string().uuid().nullable(),
  name: NullableTextSchema,
  revision: z.number().int().positive().nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  profile: z.record(z.unknown()),
}).strict();
export type DraftWritingStyleV2 = z.infer<typeof DraftWritingStyleV2Schema>;

export const DraftSellerProfileV2Schema = z.object({
  name: NullableTextSchema,
  jobTitle: NullableTextSchema,
  companyName: z.string().trim().min(1).max(300),
  companyDomain: NullableTextSchema,
  sector: NullableTextSchema,
  description: NullableTextSchema,
  services: StringListSchema,
  valueProposition: NullableTextSchema,
  proofPoints: StringListSchema,
}).strict();
export type DraftSellerProfileV2 = z.infer<typeof DraftSellerProfileV2Schema>;

export const DraftEvidenceV2Schema = z.object({
  evidenceId: z.string().trim().min(1).max(256),
  statement: z.string().trim().min(1).max(4_000),
  subjectScope: z.enum(['company', 'person']),
  confidence: z.number().min(0).max(1),
  source: z.object({
    sourceId: z.string().trim().min(1).max(256),
    url: z.string().url(),
    title: NullableTextSchema,
    type: z.string().trim().min(1).max(100),
    reliability: z.number().min(0).max(1),
  }).strict(),
  supportedFactClaimIds: z.array(z.string().trim().min(1).max(256)).max(50),
}).strict();
export type DraftEvidenceV2 = z.infer<typeof DraftEvidenceV2Schema>;

export const DraftHypothesisV2Schema = z.object({
  claimId: z.string().trim().min(1).max(256),
  kind: z.string().trim().min(1).max(100),
  statement: z.string().trim().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  supportingEvidenceIds: z.array(z.string().trim().min(1).max(256)).min(1).max(50),
}).strict();
export type DraftHypothesisV2 = z.infer<typeof DraftHypothesisV2Schema>;

export const DraftContextV2Schema = z.object({
  schemaVersion: z.literal(DRAFT_CONTEXT_V2_SCHEMA_VERSION),
  research: z.object({
    snapshotId: z.string().trim().min(1).max(256),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    capturedAt: z.string().datetime({ offset: true }).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(['queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled']),
    fresh: z.boolean(),
  }).strict(),
  recipient: z.object({
    leadRef: z.string().trim().min(1).max(500),
    email: z.string().email().nullable(),
    displayName: NullableTextSchema,
  }).strict(),
  company: z.object({
    name: NullableTextSchema,
    domain: NullableTextSchema,
    websiteUrl: z.string().url().nullable(),
    linkedinUrl: z.string().url().nullable(),
    country: NullableTextSchema,
  }).strict(),
  person: z.object({
    fullName: NullableTextSchema,
    title: NullableTextSchema,
    linkedinUrl: z.string().url().nullable(),
    city: NullableTextSchema,
    country: NullableTextSchema,
  }).strict(),
  seller: DraftSellerProfileV2Schema,
  style: DraftWritingStyleV2Schema,
  quality: z.object({
    score: z.number().int().min(0).max(100),
    minimumScore: z.literal(MIN_DRAFT_QUALITY_SCORE),
    priority: z.enum(['A', 'B', 'C']),
    sufficientResearch: z.boolean(),
    draftEligible: z.boolean(),
    factors: z.record(z.number()),
  }).strict(),
  evidence: z.array(DraftEvidenceV2Schema).max(50),
  hypotheses: z.array(DraftHypothesisV2Schema).max(20),
  constraints: z.object({
    subject: z.object({ minCharacters: z.literal(3), maxCharacters: z.literal(80) }).strict(),
    body: z.object({ minWords: z.literal(60), maxWords: z.literal(180) }).strict(),
    cta: z.object({ exactText: z.string().trim().min(8).max(240), maximumCount: z.literal(1) }).strict(),
    prohibitedPhrases: z.array(z.string().trim().min(1)).min(1),
    minimumEvidenceProvenance: z.literal(1),
  }).strict(),
  warnings: z.array(z.string().trim().min(1).max(2_000)).max(20),
}).strict();
export type DraftContextV2 = z.infer<typeof DraftContextV2Schema>;

export type DraftContextBlockReason =
  | 'recipient_missing'
  | 'research_artifact_missing'
  | 'research_artifact_invalid'
  | 'research_not_ready'
  | 'research_stale'
  | 'evidence_insufficient'
  | 'quality_below_threshold';

export type DraftContextBuildResult =
  | { status: 'ready'; context: DraftContextV2 }
  | { status: 'blocked'; context: DraftContextV2; reason: DraftContextBlockReason; message: string };

export type BuildDraftContextV2Input = {
  snapshot: ResearchSnapshotV1;
  artifact: {
    contentHash?: string | null;
    capturedAt?: string | null;
  };
  seller: DraftSellerProfileV2;
  style: DraftWritingStyleV2;
  now?: Date;
};

const DEFAULT_SERVER_WRITING_STYLE_PROFILE: Record<string, unknown> = {
  tone: 'professional',
  length: 'medium',
  language: 'es-CL',
  constraints: {
    noFabrication: true,
    oneCta: true,
  },
};

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, 50)
    : [];
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function validHttpUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isFreshDate(value: string | null, nowMs: number) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= nowMs + 5 * 60 * 1000
    && timestamp >= nowMs - DRAFT_CONTEXT_MAX_AGE_MS;
}

function priorityForScore(score: number): 'A' | 'B' | 'C' {
  if (score >= 72) return 'A';
  if (score >= MIN_DRAFT_QUALITY_SCORE) return 'B';
  return 'C';
}

function qualityForSnapshot(snapshot: ResearchSnapshotV1): ResearchQualityAssessment {
  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const companyFacts = snapshot.evidence.filter((evidence) => isQualifiedResearchFactEvidence({
    evidence,
    source: sourceById.get(evidence.sourceId),
    companyName: snapshot.subject.company.name,
    companyDomain: snapshot.subject.company.domain,
  }));
  const signals = snapshot.evidence.filter((evidence) => isRelevantResearchSignal({
    evidence,
    source: sourceById.get(evidence.sourceId),
    companyName: snapshot.subject.company.name,
    companyDomain: snapshot.subject.company.domain,
  }));
  const meaningfulEvidence = [...companyFacts, ...signals];
  const verifiedSourceCount = new Set(meaningfulEvidence.map((evidence) => evidence.sourceId).filter((sourceId) => sourceIds.has(sourceId))).size;
  const companyFactSourceCount = new Set(companyFacts.map((evidence) => evidence.sourceId)).size;
  const recentSignalCount = new Set(
    signals
      .map((evidence) => sourceById.get(evidence.sourceId))
      .filter((source): source is NonNullable<typeof source> => Boolean(source?.publishedAt))
      .map((source) => source.id),
  ).size;
  return assessResearchQuality({
    status: snapshot.lifecycle.status,
    companyIdentityPresent: Boolean(snapshot.subject.company.name || snapshot.subject.company.domain),
    emailPresent: Boolean(snapshot.subject.email),
    leadRolePresent: Boolean(snapshot.subject.person.title),
    evidenceCount: meaningfulEvidence.length,
    verifiedSourceCount,
    companyFactCount: companyFacts.length,
    companyFactSourceCount,
    recentSignalCount,
    overallConfidence: snapshot.quality.overallConfidence,
  });
}

function styleCta(style: DraftWritingStyleV2) {
  const cta = object(style.profile.cta);
  const label = text(cta.label);
  return label.length >= 8 && label.length <= 240 ? label : DEFAULT_DRAFT_CTA;
}

export function createDefaultDraftWritingStyleV2(): DraftWritingStyleV2 {
  return DraftWritingStyleV2Schema.parse({
    id: null,
    name: 'Native outreach baseline',
    revision: null,
    contentHash: canonicalSha256(DEFAULT_SERVER_WRITING_STYLE_PROFILE),
    profile: DEFAULT_SERVER_WRITING_STYLE_PROFILE,
  });
}

export function normalizeDraftSellerProfileV2(value: unknown): DraftSellerProfileV2 {
  const profile = object(value);
  return DraftSellerProfileV2Schema.parse({
    name: nullableText(profile.name),
    jobTitle: nullableText(profile.jobTitle),
    companyName: nullableText(profile.companyName) || 'Mi empresa',
    companyDomain: nullableText(profile.companyDomain),
    sector: nullableText(profile.sector),
    description: nullableText(profile.description),
    services: list(profile.services),
    valueProposition: nullableText(profile.valueProposition),
    proofPoints: list(profile.proofPoints),
  });
}

export function normalizeDraftWritingStyleV2(value: unknown): DraftWritingStyleV2 {
  const style = object(value);
  const profile = object(style.profile);
  const hash = text(style.contentHash);
  return DraftWritingStyleV2Schema.parse({
    id: nullableText(style.id),
    name: nullableText(style.name),
    revision: Number.isInteger(style.revision) && Number(style.revision) > 0 ? Number(style.revision) : null,
    contentHash: /^[a-f0-9]{64}$/.test(hash) ? hash : canonicalSha256(profile),
    profile,
  });
}

export function buildDraftContextV2(input: BuildDraftContextV2Input): DraftContextBuildResult {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  const nowMs = (input.now || new Date()).getTime();
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  const artifactHash = text(input.artifact.contentHash);
  const snapshotHash = canonicalSha256(snapshot);
  const artifactHashMatches = /^[a-f0-9]{64}$/.test(artifactHash) && artifactHash === snapshotHash;
  const factClaimsByEvidenceId = new Map<string, string[]>();

  const freshCompanyFactClaims = snapshot.claims.filter((claim) =>
    isDraftableCompanyFactClaim({ snapshot, claim, nowMs }),
  );
  const freshFactClaims = [
    ...freshCompanyFactClaims,
    ...snapshot.claims.filter((claim) => isDraftablePersonFactClaim({ snapshot, claim, nowMs })),
  ];
  const hasEvidenceBackedFact = freshCompanyFactClaims.length > 0;
  for (const claim of freshFactClaims) {
    for (const evidenceId of claim.supportingEvidenceIds) {
      const current = factClaimsByEvidenceId.get(evidenceId) || [];
      factClaimsByEvidenceId.set(evidenceId, [...current, claim.id]);
    }
  }

  const evidence = snapshot.evidence.flatMap((item) => {
    const source = sourceById.get(item.sourceId);
    const sourceUrl = validHttpUrl(source?.url);
    const qualifiedFact = isQualifiedResearchFactEvidence({
      evidence: item,
      source,
      companyName: snapshot.subject.company.name,
      companyDomain: snapshot.subject.company.domain,
    });
    const qualifiedPersonFact = isQualifiedResearchPersonFactEvidence({
      evidence: item,
      source,
      personName: snapshot.subject.person.fullName,
    });
    const relevantSignal = isRelevantResearchSignal({
      evidence: item,
      source,
      companyName: snapshot.subject.company.name,
      companyDomain: snapshot.subject.company.domain,
    });
    if (!source || !sourceUrl || (!qualifiedFact && !qualifiedPersonFact && !relevantSignal)) return [];
    return [DraftEvidenceV2Schema.parse({
      evidenceId: item.id,
      statement: item.statement,
      subjectScope: item.subjectScope,
      confidence: item.confidence,
      source: {
        sourceId: source.id,
        url: sourceUrl,
        title: nullableText(source.title),
        type: source.type,
        reliability: source.reliability,
      },
      supportedFactClaimIds: factClaimsByEvidenceId.get(item.id) || [],
    })];
  });
  const hypotheses = snapshot.claims
    .filter((claim) => claim.classification === 'hypothesis' && isFreshResearchClaim(claim, nowMs))
    .flatMap((claim) => {
      const supportingEvidenceIds = claim.supportingEvidenceIds.filter((evidenceId) => {
        const evidenceItem = evidenceById.get(evidenceId);
        const source = evidenceItem ? sourceById.get(evidenceItem.sourceId) : undefined;
        return Boolean(evidenceItem && source && validHttpUrl(source.url) && (
          isQualifiedResearchFactEvidence({
            evidence: evidenceItem,
            source,
            companyName: snapshot.subject.company.name,
            companyDomain: snapshot.subject.company.domain,
          }) || isRelevantResearchSignal({
            evidence: evidenceItem,
            source,
            companyName: snapshot.subject.company.name,
            companyDomain: snapshot.subject.company.domain,
          })
        ));
      });
      return supportingEvidenceIds.length > 0
        ? [DraftHypothesisV2Schema.parse({
          claimId: claim.id,
          kind: claim.kind,
          statement: claim.statement,
          confidence: claim.confidence,
          supportingEvidenceIds,
        })]
        : [];
    });
  const quality = qualityForSnapshot(snapshot);
  const capturedAt = nullableText(input.artifact.capturedAt);
  const contentHash = artifactHashMatches ? artifactHash : '';
  const researchFresh = artifactHashMatches && isFreshDate(capturedAt, nowMs) && freshFactClaims.length > 0;
  const warnings = [
    ...(!artifactHashMatches ? ['La investigación no coincide con su artefacto verificable.'] : []),
    ...(snapshot.lifecycle.status === 'partial' ? ['La investigación es parcial; la aprobación requiere revisión cuidadosa.'] : []),
    ...snapshot.lifecycle.errors
      .filter((error) => error.severity === 'warning')
      .map((error) => error.message),
  ].slice(0, 20);
  const context = DraftContextV2Schema.parse({
    schemaVersion: DRAFT_CONTEXT_V2_SCHEMA_VERSION,
    research: {
      snapshotId: snapshot.id,
      contentHash: /^[a-f0-9]{64}$/.test(contentHash) ? contentHash : null,
      capturedAt,
      updatedAt: snapshot.updatedAt,
      status: snapshot.lifecycle.status,
      fresh: researchFresh,
    },
    recipient: {
      leadRef: snapshot.subject.leadRef,
      email: snapshot.subject.email || null,
      displayName: snapshot.subject.person.fullName || null,
    },
    company: {
      name: snapshot.subject.company.name || null,
      domain: snapshot.subject.company.domain || null,
      websiteUrl: snapshot.subject.company.websiteUrl || null,
      linkedinUrl: snapshot.subject.company.linkedinUrl || null,
      country: snapshot.subject.company.country || null,
    },
    person: {
      fullName: snapshot.subject.person.fullName || null,
      title: snapshot.subject.person.title || null,
      linkedinUrl: snapshot.subject.person.linkedinUrl || null,
      city: snapshot.subject.person.city || null,
      country: snapshot.subject.person.country || null,
    },
    seller: DraftSellerProfileV2Schema.parse(input.seller),
    style: DraftWritingStyleV2Schema.parse(input.style),
    quality: {
      score: quality.score,
      minimumScore: MIN_DRAFT_QUALITY_SCORE,
      priority: priorityForScore(quality.score),
      sufficientResearch: quality.sufficientResearch,
      draftEligible: quality.draftEligibility.eligible,
      factors: quality.factors,
    },
    evidence,
    hypotheses,
    constraints: {
      subject: { minCharacters: 3, maxCharacters: 80 },
      body: { minWords: 60, maxWords: 180 },
      cta: { exactText: styleCta(input.style), maximumCount: 1 },
      prohibitedPhrases: [...DRAFT_PROHIBITED_PHRASES],
      minimumEvidenceProvenance: 1,
    },
    warnings,
  });

  if (!context.recipient.email) {
    return { status: 'blocked', context, reason: 'recipient_missing', message: 'La investigación no tiene un email válido para crear un borrador.' };
  }
  if (!context.research.capturedAt) {
    return { status: 'blocked', context, reason: 'research_artifact_missing', message: 'Falta el artefacto verificable de la investigación.' };
  }
  if (!artifactHashMatches) {
    return { status: 'blocked', context, reason: 'research_artifact_invalid', message: 'La investigación no coincide con su artefacto verificable.' };
  }
  if (snapshot.lifecycle.status === 'insufficient_data') {
    return { status: 'blocked', context, reason: 'evidence_insufficient', message: 'No hay evidencia verificable suficiente para personalizar un correo.' };
  }
  if (!['completed', 'partial'].includes(snapshot.lifecycle.status)) {
    return { status: 'blocked', context, reason: 'research_not_ready', message: 'La investigación todavía no está lista para redactar.' };
  }
  if (!quality.sufficientResearch || !hasEvidenceBackedFact) {
    return { status: 'blocked', context, reason: 'evidence_insufficient', message: 'No hay evidencia verificable suficiente para personalizar un correo.' };
  }
  if (!context.research.fresh) {
    return { status: 'blocked', context, reason: 'research_stale', message: 'La investigación o sus afirmaciones verificables ya no están vigentes.' };
  }
  if (!quality.draftEligibility.eligible || quality.score < MIN_DRAFT_QUALITY_SCORE) {
    return { status: 'blocked', context, reason: 'quality_below_threshold', message: `La calidad de investigación (${quality.score}) no alcanza el mínimo para redactar (${MIN_DRAFT_QUALITY_SCORE}).` };
  }
  return { status: 'ready', context };
}
