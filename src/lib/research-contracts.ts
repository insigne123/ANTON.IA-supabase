import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const identifier = nonEmptyString.max(256);
const uniqueIdentifiers = z.array(identifier).superRefine((values, ctx) => {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate reference: ${value}`,
        path: [index],
      });
    }
    seen.add(value);
  });
});

const researchFailureMarkers = new Set(['fallback', 'http_error', 'invalid_response']);

function asResearchRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function asResearchArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizedResearchMarker(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  if (normalized.includes('invalid_response') || normalized.startsWith('error_parsing.')) return 'invalid_response';
  if (normalized.includes('http_error') || normalized.includes('provider_http_error')) return 'http_error';
  if (normalized.includes('fallback') || normalized.startsWith('no_se_pudo_completar_la_investigacion_automatica')) return 'fallback';
  return researchFailureMarkers.has(normalized) ? normalized : '';
}

function hasHttpUrl(value: unknown): boolean {
  try {
    const protocol = new URL(String(value || '')).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSubstantiveResearchTextV1(value: unknown): boolean {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || hasHttpUrl(text) || normalizedResearchMarker(text)) return false;
  if (['n/a', 'none', 'null', 'undefined', 'unknown', 'sin datos', 'no disponible'].includes(text.toLowerCase())) return false;
  const terms = text.match(/[\p{L}\p{N}]+/gu) || [];
  return text.length >= 12 && terms.length >= 3;
}

function researchStatement(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  const record = asResearchRecord(value);
  return String(record.statement || record.detail || record.summary || record.title || record.text || record.value || '').trim();
}

function isSubstantiveResearchItem(value: unknown): boolean {
  const record = asResearchRecord(value);
  if (record.kind === 'company_identity') return false;
  return isSubstantiveResearchTextV1(researchStatement(value));
}

function sourceReferences(value: unknown): string[] {
  const record = asResearchRecord(value);
  return [record.source_ids, record.sourceIds, record.source_id, record.sourceId]
    .flatMap((item) => Array.isArray(item) ? item : item == null ? [] : [item])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function collectResearchPayloads(value: unknown): Record<string, any>[] {
  const root = asResearchRecord(value);
  const raw = asResearchRecord(root.raw);
  return Object.keys(raw).length > 0 ? [raw, root] : [root];
}

function collectResearchSources(payloads: Record<string, any>[]) {
  const byId = new Map<string, string>();
  const urls = new Set<string>();
  const add = (source: unknown) => {
    const record = asResearchRecord(source);
    const url = typeof source === 'string' ? source : record.url;
    if (!hasHttpUrl(url)) return;
    const normalizedUrl = String(url).trim();
    urls.add(normalizedUrl);
    const id = String(record.id || record.source_id || record.sourceId || '').trim();
    if (id) byId.set(id, normalizedUrl);
  };

  payloads.forEach((payload) => {
    const cross = asResearchRecord(asResearchRecord(payload.existing_compat).cross || payload.cross);
    const website = asResearchRecord(payload.websiteSummary || payload.website_summary);
    asResearchArray(payload.sources).forEach(add);
    asResearchArray(cross.sources).forEach(add);
    asResearchArray(website.sources).forEach(add);
    asResearchArray(payload.signals).forEach(add);
  });
  return { byId, urls };
}

function hasResearchFailureMarker(payloads: Record<string, any>[]): string {
  for (const payload of payloads) {
    const raw = asResearchRecord(payload.raw);
    const lifecycle = asResearchRecord(payload.lifecycle);
    const markerCandidates = [
      payload.source,
      payload.failure_marker,
      raw.source,
      payload.overview,
      asResearchRecord(payload.company_context).overview,
      asResearchRecord(payload.website_summary).overview,
      asResearchRecord(payload.cross).overview,
    ];
    for (const candidate of markerCandidates) {
      const marker = normalizedResearchMarker(researchStatement(candidate));
      if (marker) return marker;
    }
    for (const warning of [...asResearchArray(payload.warnings), ...asResearchArray(payload.provider_warnings)]) {
      const marker = normalizedResearchMarker(researchStatement(warning));
      if (marker) return marker;
    }
    for (const error of asResearchArray(lifecycle.errors)) {
      const record = asResearchRecord(error);
      const marker = normalizedResearchMarker(record.code || record.message);
      if (marker) return marker;
    }
  }
  return '';
}

function hasSubstantiveResearchContent(payloads: Record<string, any>[]): boolean {
  return payloads.some((payload) => {
    const cross = asResearchRecord(asResearchRecord(payload.existing_compat).cross || payload.cross);
    const companyContext = asResearchRecord(payload.company_context);
    const website = asResearchRecord(payload.websiteSummary || payload.website_summary);
    const candidates = [
      payload.overview,
      cross.overview,
      companyContext.overview,
      website.overview,
      ...asResearchArray(payload.claims),
      ...asResearchArray(payload.signals),
      ...asResearchArray(payload.pains),
      ...asResearchArray(cross.pains),
      ...asResearchArray(companyContext.pain_hypotheses),
      ...asResearchArray(payload.opportunities),
      ...asResearchArray(cross.opportunities),
      ...asResearchArray(companyContext.opportunity_hypotheses),
      ...asResearchArray(website.services),
    ];
    return candidates.some(isSubstantiveResearchItem);
  });
}

function hasExplicitEvidenceLink(
  payloads: Record<string, any>[],
  sourceById: Map<string, string>,
  sourceUrls: Set<string>,
): boolean {
  const hasResolvedSource = (value: unknown, inheritedReferences: string[] = []) => {
    if (!isSubstantiveResearchItem(value)) return false;
    const record = asResearchRecord(value);
    const directUrl = record.url || record.source_url || record.sourceUrl;
    if (hasHttpUrl(directUrl) && sourceUrls.has(String(directUrl).trim())) return true;
    return [...sourceReferences(value), ...inheritedReferences].some((reference) => sourceById.has(reference));
  };

  return payloads.some((payload) => {
    const evidenceById = new Map(
      asResearchArray(payload.evidence)
        .map((evidence) => asResearchRecord(evidence))
        .filter((evidence) => sourceById.has(String(evidence.sourceId || evidence.source_id || '').trim()))
        .map((evidence) => [String(evidence.id || '').trim(), evidence] as const),
    );
    const canonicalLink = asResearchArray(payload.claims).some((claim) => {
      const record = asResearchRecord(claim);
      if (!isSubstantiveResearchItem(record)) return false;
      const references = asResearchArray(record.supportingEvidenceIds || record.supporting_evidence_ids)
        .map((id) => String(id || '').trim());
      return references.some((id) => evidenceById.has(id));
    });
    if (canonicalLink) return true;

    const cross = asResearchRecord(asResearchRecord(payload.existing_compat).cross || payload.cross);
    const companyContext = asResearchRecord(payload.company_context);
    const website = asResearchRecord(payload.websiteSummary || payload.website_summary);
    const linkedCandidates: Array<[unknown, string[]]> = [
      [payload.overview, sourceReferences(payload)],
      [cross.overview, sourceReferences(cross)],
      [companyContext.overview, sourceReferences(companyContext)],
      [website.overview, sourceReferences(website)],
      ...asResearchArray(website.services).map((item) => [item, sourceReferences(website)] as [unknown, string[]]),
      ...asResearchArray(payload.signals).map((item) => [item, []] as [unknown, string[]]),
      ...asResearchArray(payload.pains).map((item) => [item, []] as [unknown, string[]]),
      ...asResearchArray(cross.pains).map((item) => [item, []] as [unknown, string[]]),
      ...asResearchArray(companyContext.pain_hypotheses).map((item) => [item, []] as [unknown, string[]]),
      ...asResearchArray(payload.opportunities).map((item) => [item, []] as [unknown, string[]]),
      ...asResearchArray(cross.opportunities).map((item) => [item, []] as [unknown, string[]]),
      ...asResearchArray(companyContext.opportunity_hypotheses).map((item) => [item, []] as [unknown, string[]]),
    ];
    return linkedCandidates.some(([candidate, inherited]) => hasResolvedSource(candidate, inherited));
  });
}

export function hasMeaningfulResearchContentV1(value: unknown): boolean {
  return hasSubstantiveResearchContent(collectResearchPayloads(value));
}

export function getResearchAutoContactBlockReasonV1(value: unknown): string | null {
  const payloads = collectResearchPayloads(value);
  if (payloads.every((payload) => Object.keys(payload).length === 0)) return 'missing_research';
  const primary = payloads[0];
  const status = String(asResearchRecord(primary.lifecycle).status || primary.status || '').trim().toLowerCase();
  if (status !== 'completed') return status || 'missing_research_status';
  const failureMarker = hasResearchFailureMarker(payloads);
  if (failureMarker) return failureMarker;
  if (!hasSubstantiveResearchContent(payloads)) return 'insufficient_research';
  const sources = collectResearchSources(payloads);
  if (sources.urls.size === 0) return 'missing_research_sources';
  if (!hasExplicitEvidenceLink(payloads, sources.byId, sources.urls)) return 'missing_evidence_links';
  return null;
}

function stableResearchHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildResearchRequestIdempotencyKeyV1(input: {
  ownerId: string;
  leadRef?: string | null;
  email?: string | null;
  companyDomain?: string | null;
  provider?: string | null;
  freshnessBucket?: string | number | null;
  jobIdentity?: string | null;
}): string {
  const normalize = (value: unknown) => String(value || '').trim().toLowerCase();
  const identity = input.jobIdentity
    ? `job:${normalize(input.jobIdentity)}`
    : `freshness:${normalize(input.freshnessBucket)}`;
  const seed = [
    'research-request/v1',
    normalize(input.provider) || 'provider',
    normalize(input.ownerId),
    normalize(input.leadRef),
    normalize(input.email),
    normalize(input.companyDomain),
    identity,
  ].join('|');
  return `research:v1:${stableResearchHash(seed)}`;
}

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/, 'Expected a sha256 fingerprint');
export const ConfidenceV1Schema = z.number().finite().min(0).max(1);
export const HttpUrlSchema = z.string().url().superRefine((value, ctx) => {
  let protocol: string | undefined;
  try {
    protocol = new URL(value).protocol;
  } catch {
    return;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected an HTTP(S) URL' });
  }
});

const OrganizationOwnershipScopeV1Schema = z.object({
  kind: z.literal('organization'),
  organizationId: identifier,
  ownerUserId: identifier,
}).strict();

const UserOwnershipScopeV1Schema = z.object({
  kind: z.literal('user'),
  organizationId: z.null(),
  ownerUserId: identifier,
}).strict();

export const OwnershipScopeV1Schema = z.discriminatedUnion('kind', [
  OrganizationOwnershipScopeV1Schema,
  UserOwnershipScopeV1Schema,
]);

export const ContractErrorCodeV1Schema = z.enum([
  'provider_timeout',
  'provider_http_error',
  'invalid_response',
  'truncated_response',
  'validation_failed',
  'identity_mismatch',
  'insufficient_evidence',
  'persistence_failed',
  'generation_failed',
  'cancelled',
  'unknown',
]);

export const ContractErrorV1Schema = z.object({
  code: ContractErrorCodeV1Schema,
  stage: z.enum(['request', 'fetch', 'parse', 'normalize', 'validate', 'persist', 'generate', 'preflight']),
  severity: z.enum(['warning', 'blocking']),
  retryable: z.boolean(),
  message: nonEmptyString,
  provider: nonEmptyString.optional(),
  sourceId: identifier.optional(),
  observedAt: IsoDateTimeSchema,
}).strict();

export const ResearchSourceV1Schema = z.object({
  id: identifier,
  type: z.enum([
    'official_site',
    'linkedin',
    'news',
    'jobs',
    'technology',
    'search_result',
    'registry',
    'other',
  ]),
  url: HttpUrlSchema,
  canonicalUrl: HttpUrlSchema,
  title: nonEmptyString.optional(),
  publisher: nonEmptyString.optional(),
  provider: nonEmptyString,
  publishedAt: IsoDateTimeSchema.optional(),
  retrievedAt: IsoDateTimeSchema,
  contentHash: Sha256Schema.optional(),
  reliability: ConfidenceV1Schema,
}).strict();

export const ResearchEvidenceLocatorV1Schema = z.object({
  kind: z.enum(['json_path', 'provider_annotation', 'page_section', 'search_snippet']),
  value: nonEmptyString,
}).strict();

export const ResearchEvidenceV1Schema = z.object({
  id: identifier,
  subjectScope: z.enum(['company', 'person']),
  kind: z.enum(['fact', 'quote', 'event', 'profile_field', 'observation']),
  path: nonEmptyString,
  statement: nonEmptyString,
  sourceId: identifier,
  locator: ResearchEvidenceLocatorV1Schema.optional(),
  excerpt: nonEmptyString.optional(),
  observedAt: IsoDateTimeSchema.optional(),
  extractedAt: IsoDateTimeSchema,
  confidence: ConfidenceV1Schema,
  extraction: z.object({
    method: z.enum(['rule', 'provider', 'model']),
    provider: nonEmptyString,
    model: nonEmptyString.optional(),
    version: nonEmptyString,
  }).strict(),
}).strict();

export const ResearchClaimKindV1Schema = z.enum([
  'company_overview',
  'company_identity',
  'company_industry',
  'company_service',
  'company_size',
  'company_priority',
  'pain_hypothesis',
  'opportunity_hypothesis',
  'risk_hypothesis',
  'use_case_hypothesis',
  'lead_profile',
  'lead_role',
  'lead_recent_activity',
  'lead_communication_style',
  'news_signal',
  'hiring_signal',
  'technology_signal',
  'site_signal',
]);

export const ResearchClaimV1Schema = z.object({
  id: identifier,
  kind: ResearchClaimKindV1Schema,
  subjectScope: z.enum(['company', 'person']),
  classification: z.enum(['fact', 'hypothesis']),
  statement: nonEmptyString,
  supportingEvidenceIds: uniqueIdentifiers,
  contradictingEvidenceIds: uniqueIdentifiers,
  confidence: ConfidenceV1Schema,
  freshness: z.object({
    asOf: IsoDateTimeSchema,
    validUntil: IsoDateTimeSchema,
    policyVersion: z.literal('research-freshness/v1'),
  }).strict(),
  derivation: z.object({
    method: z.enum(['direct', 'rule', 'model']),
    model: nonEmptyString.optional(),
    promptVersion: nonEmptyString.optional(),
  }).strict(),
}).strict();

export const ResearchStatusV1Schema = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'insufficient_data',
  'failed',
  'cancelled',
]);

export const ResearchContradictionV1Schema = z.object({
  id: identifier,
  claimIds: uniqueIdentifiers,
  evidenceIds: uniqueIdentifiers,
  summary: nonEmptyString,
  status: z.enum(['unresolved', 'resolved']),
  resolution: nonEmptyString.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'resolved' && !value.resolution) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Resolved contradictions require a resolution',
      path: ['resolution'],
    });
  }
});

const ResearchSnapshotV1BaseSchema = z.object({
  kind: z.literal('research_snapshot'),
  schemaVersion: z.literal('research-snapshot/v1'),
  id: identifier,
  revision: z.literal(1),
  scope: OwnershipScopeV1Schema,
  subject: z.object({
    leadRef: identifier,
    leadId: identifier.optional(),
    email: z.string().email().optional(),
    person: z.object({
      fullName: nonEmptyString.optional(),
      title: nonEmptyString.optional(),
      linkedinUrl: HttpUrlSchema.optional(),
      city: nonEmptyString.optional(),
      country: nonEmptyString.optional(),
    }).strict(),
    company: z.object({
      name: nonEmptyString.optional(),
      domain: nonEmptyString.optional(),
      websiteUrl: HttpUrlSchema.optional(),
      linkedinUrl: HttpUrlSchema.optional(),
      country: nonEmptyString.optional(),
    }).strict(),
  }).strict(),
  request: z.object({
    requestId: identifier,
    idempotencyKey: identifier,
    inputFingerprint: Sha256Schema,
    provider: nonEmptyString,
    providerJobId: identifier.optional(),
    language: nonEmptyString,
    depth: z.enum(['basic', 'standard', 'deep']),
    requestedAt: IsoDateTimeSchema,
  }).strict(),
  lifecycle: z.object({
    status: ResearchStatusV1Schema,
    queuedAt: IsoDateTimeSchema.optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    errors: z.array(ContractErrorV1Schema),
  }).strict(),
  sources: z.array(ResearchSourceV1Schema),
  evidence: z.array(ResearchEvidenceV1Schema),
  claims: z.array(ResearchClaimV1Schema),
  contradictions: z.array(ResearchContradictionV1Schema),
  quality: z.object({
    assessmentVersion: z.literal('research-quality/v1'),
    coverage: z.object({
      company: ConfidenceV1Schema,
      person: ConfidenceV1Schema,
      recentSignals: ConfidenceV1Schema,
    }).strict(),
    overallConfidence: ConfidenceV1Schema,
  }).strict(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();

const partialWarningCodes = new Set<z.infer<typeof ContractErrorCodeV1Schema>>([
  'provider_timeout',
  'provider_http_error',
  'invalid_response',
  'truncated_response',
  'validation_failed',
  'identity_mismatch',
  'insufficient_evidence',
]);

function addDuplicateIdIssues(
  values: Array<{ id: string }>,
  collection: 'sources' | 'evidence' | 'claims' | 'contradictions',
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate ${collection} ID: ${value.id}`,
        path: [collection, index, 'id'],
      });
    }
    seen.add(value.id);
  });
}

export const ResearchSnapshotV1Schema = ResearchSnapshotV1BaseSchema.superRefine((snapshot, ctx) => {
  addDuplicateIdIssues(snapshot.sources, 'sources', ctx);
  addDuplicateIdIssues(snapshot.evidence, 'evidence', ctx);
  addDuplicateIdIssues(snapshot.claims, 'claims', ctx);
  addDuplicateIdIssues(snapshot.contradictions, 'contradictions', ctx);

  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  const evidenceIds = new Set(snapshot.evidence.map((evidence) => evidence.id));
  const claimIds = new Set(snapshot.claims.map((claim) => claim.id));
  const idOwners = new Map<string, string>();
  ([
    ['sources', snapshot.sources],
    ['evidence', snapshot.evidence],
    ['claims', snapshot.claims],
  ] as const).forEach(([collection, values]) => {
    values.forEach((value, index) => {
      const owner = idOwners.get(value.id);
      if (owner && owner !== collection) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ID ${value.id} is already used by ${owner}`,
          path: [collection, index, 'id'],
        });
      } else {
        idOwners.set(value.id, collection);
      }
    });
  });

  snapshot.evidence.forEach((evidence, index) => {
    if (!sourceIds.has(evidence.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown source reference: ${evidence.sourceId}`,
        path: ['evidence', index, 'sourceId'],
      });
    }
  });

  snapshot.claims.forEach((claim, claimIndex) => {
    (['supportingEvidenceIds', 'contradictingEvidenceIds'] as const).forEach((field) => {
      claim[field].forEach((evidenceId, evidenceIndex) => {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown evidence reference: ${evidenceId}`,
            path: ['claims', claimIndex, field, evidenceIndex],
          });
        }
      });
    });
  });

  snapshot.contradictions.forEach((contradiction, contradictionIndex) => {
    contradiction.claimIds.forEach((claimId, claimIndex) => {
      if (!claimIds.has(claimId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown claim reference: ${claimId}`,
          path: ['contradictions', contradictionIndex, 'claimIds', claimIndex],
        });
      }
    });
    contradiction.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceIds.has(evidenceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown evidence reference: ${evidenceId}`,
          path: ['contradictions', contradictionIndex, 'evidenceIds', evidenceIndex],
        });
      }
    });
  });

  snapshot.lifecycle.errors.forEach((error, index) => {
    if (error.sourceId && !sourceIds.has(error.sourceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown source reference: ${error.sourceId}`,
        path: ['lifecycle', 'errors', index, 'sourceId'],
      });
    }
  });

  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.id, evidence]));
  const hasUsableClaim = snapshot.claims.some((claim) =>
    claim.kind !== 'company_identity'
    && isSubstantiveResearchTextV1(claim.statement)
    && claim.supportingEvidenceIds.some((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return Boolean(evidence && sourceIds.has(evidence.sourceId));
    }),
  );
  const hasBlockingError = snapshot.lifecycle.errors.some((error) => error.severity === 'blocking');

  if (snapshot.lifecycle.status === 'completed') {
    if (!hasUsableClaim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed research requires an evidence-backed meaningful claim',
        path: ['lifecycle', 'status'],
      });
    }
    if (hasBlockingError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Completed research cannot contain blocking errors',
        path: ['lifecycle', 'errors'],
      });
    }
    const readinessReason = getResearchAutoContactBlockReasonV1(snapshot);
    if (readinessReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Completed research is not ready for automatic use: ${readinessReason}`,
        path: ['lifecycle', 'status'],
      });
    }
  }

  if (snapshot.lifecycle.status === 'partial') {
    if (!hasUsableClaim) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Partial research requires at least one usable claim',
        path: ['lifecycle', 'status'],
      });
    }
    const hasRelevantWarning = snapshot.lifecycle.errors.some((error) =>
      error.severity === 'warning' && (partialWarningCodes.has(error.code) || Boolean(error.sourceId)),
    );
    if (!hasRelevantWarning) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Partial research requires a coverage, source, or parsing warning',
        path: ['lifecycle', 'errors'],
      });
    }
  }
});

export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type Sha256 = z.infer<typeof Sha256Schema>;
export type ConfidenceV1 = z.infer<typeof ConfidenceV1Schema>;
export type OwnershipScopeV1 = z.infer<typeof OwnershipScopeV1Schema>;
export type ContractErrorV1 = z.infer<typeof ContractErrorV1Schema>;
export type ResearchSourceV1 = z.infer<typeof ResearchSourceV1Schema>;
export type ResearchEvidenceV1 = z.infer<typeof ResearchEvidenceV1Schema>;
export type ResearchClaimKindV1 = z.infer<typeof ResearchClaimKindV1Schema>;
export type ResearchClaimV1 = z.infer<typeof ResearchClaimV1Schema>;
export type ResearchStatusV1 = z.infer<typeof ResearchStatusV1Schema>;
export type ResearchContradictionV1 = z.infer<typeof ResearchContradictionV1Schema>;
export type ResearchSnapshotV1 = z.infer<typeof ResearchSnapshotV1Schema>;
