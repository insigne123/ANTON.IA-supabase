import {
  buildDraftContextV2,
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
  type DraftContextV2,
} from './draft-context-v2';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { ResearchSnapshotV1Schema, type ResearchSnapshotV1 } from '@/lib/research-contracts';

export const DRAFT_FIXTURE_NOW = new Date('2026-08-22T12:00:00.000Z');
export const DRAFT_FIXTURE_IDS = {
  organization: '30000000-0000-4000-8000-000000000001',
  user: '40000000-0000-4000-8000-000000000001',
  snapshot: '50000000-0000-4000-8000-000000000001',
};

const capturedAt = '2026-08-20T12:00:00.000Z';
const validUntil = '2026-09-20T12:00:00.000Z';

export function draftSnapshotFixture(input: { includeRole?: boolean } = {}): ResearchSnapshotV1 {
  const includeRole = input.includeRole ?? true;
  const sources = [
    {
      id: 'source-acme',
      type: 'official_site' as const,
      url: 'https://acme.example/about',
      canonicalUrl: 'https://acme.example/about',
      title: 'Acme',
      provider: 'fixture',
      retrievedAt: capturedAt,
      reliability: 0.92,
    },
    ...(includeRole ? [{
      id: 'source-ada',
      type: 'linkedin' as const,
      url: 'https://www.linkedin.com/in/ada-lovelace',
      canonicalUrl: 'https://www.linkedin.com/in/ada-lovelace',
      title: 'Ada Lovelace',
      provider: 'fixture',
      retrievedAt: capturedAt,
      reliability: 0.8,
    }] : []),
  ];
  const evidence = [
    {
      id: 'evidence-acme',
      subjectScope: 'company' as const,
      kind: 'fact' as const,
      path: 'fixture.company',
      statement: 'Acme publica que ayuda a equipos de operaciones a reducir trabajo manual.',
      sourceId: 'source-acme',
      extractedAt: capturedAt,
      confidence: 0.9,
      extraction: { method: 'rule' as const, provider: 'fixture', version: 'fixture/v1' },
    },
    ...(includeRole ? [{
      id: 'evidence-ada',
      subjectScope: 'person' as const,
      kind: 'profile_field' as const,
      path: 'fixture.person',
      statement: 'Ada Lovelace figura como Directora de Operaciones en Acme.',
      sourceId: 'source-ada',
      extractedAt: capturedAt,
      confidence: 0.8,
      extraction: { method: 'rule' as const, provider: 'fixture', version: 'fixture/v1' },
    }] : []),
  ];
  const claims = [
    {
      id: 'claim-acme-overview',
      kind: 'company_overview' as const,
      subjectScope: 'company' as const,
      classification: 'fact' as const,
      statement: 'Acme comunica una propuesta para reducir trabajo manual en operaciones.',
      supportingEvidenceIds: ['evidence-acme'],
      contradictingEvidenceIds: [],
      confidence: 0.86,
      freshness: { asOf: capturedAt, validUntil, policyVersion: 'research-freshness/v1' as const },
      derivation: { method: 'rule' as const, promptVersion: 'fixture/v1' },
    },
    ...(includeRole ? [{
      id: 'claim-ada-role',
      kind: 'lead_role' as const,
      subjectScope: 'person' as const,
      classification: 'fact' as const,
      statement: 'Ada Lovelace ocupa el cargo de Directora de Operaciones.',
      supportingEvidenceIds: ['evidence-ada'],
      contradictingEvidenceIds: [],
      confidence: 0.8,
      freshness: { asOf: capturedAt, validUntil, policyVersion: 'research-freshness/v1' as const },
      derivation: { method: 'rule' as const, promptVersion: 'fixture/v1' },
    }] : []),
    {
      id: 'claim-acme-opportunity',
      kind: 'opportunity_hypothesis' as const,
      subjectScope: 'company' as const,
      classification: 'hypothesis' as const,
      statement: 'Podría ser útil explorar si Acme tiene una prioridad activa para acelerar sus operaciones.',
      supportingEvidenceIds: ['evidence-acme'],
      contradictingEvidenceIds: [],
      confidence: 0.62,
      freshness: { asOf: capturedAt, validUntil: '2026-08-29T12:00:00.000Z', policyVersion: 'research-freshness/v1' as const },
      derivation: { method: 'rule' as const, promptVersion: 'fixture/v1' },
    },
  ];

  return ResearchSnapshotV1Schema.parse({
    kind: 'research_snapshot',
    schemaVersion: 'research-snapshot/v1',
    id: DRAFT_FIXTURE_IDS.snapshot,
    revision: 1,
    scope: { kind: 'organization', organizationId: DRAFT_FIXTURE_IDS.organization, ownerUserId: DRAFT_FIXTURE_IDS.user },
    subject: {
      leadRef: 'lead-ada',
      leadId: 'lead-ada',
      email: 'ada@acme.example',
      person: {
        fullName: 'Ada Lovelace',
        ...(includeRole ? { title: 'Directora de Operaciones', linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace' } : {}),
      },
      company: {
        name: 'Acme',
        domain: 'acme.example',
        websiteUrl: 'https://acme.example/about',
      },
    },
    request: {
      requestId: 'request-acme',
      idempotencyKey: 'request-key-acme',
      inputFingerprint: `sha256:${'a'.repeat(64)}`,
      provider: 'fixture',
      language: 'es',
      depth: 'standard',
      requestedAt: capturedAt,
    },
    lifecycle: { status: 'completed', queuedAt: capturedAt, startedAt: capturedAt, completedAt: capturedAt, errors: [] },
    sources,
    evidence,
    claims,
    contradictions: [],
    quality: { assessmentVersion: 'research-quality/v1', coverage: { company: 0.8, person: includeRole ? 0.8 : 0.2, recentSignals: 0 }, overallConfidence: 0.8 },
    createdAt: capturedAt,
    updatedAt: capturedAt,
  });
}

export function draftContextFixture(input: {
  includeRole?: boolean;
  capturedAt?: string;
} = {}): DraftContextV2 {
  const snapshot = draftSnapshotFixture({ includeRole: input.includeRole });
  const result = buildDraftContextV2({
    snapshot,
    artifact: {
      contentHash: canonicalSha256(snapshot),
      capturedAt: input.capturedAt || capturedAt,
    },
    seller: normalizeDraftSellerProfileV2({
      name: 'Grace Hopper',
      jobTitle: 'Fundadora',
      companyName: 'Northstar',
      services: ['Automatización de operaciones'],
      valueProposition: 'Reducimos trabajo manual con automatización responsable.',
    }),
    style: createDefaultDraftWritingStyleV2(),
    now: DRAFT_FIXTURE_NOW,
  });
  if (result.status !== 'ready') throw new Error(`Expected a ready fixture context, received ${result.reason}`);
  return result.context;
}
