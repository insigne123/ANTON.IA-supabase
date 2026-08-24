import {
  MessagingDraftV1Schema,
  canonicalSha256,
  deterministicMessagingUuid,
  hashMessagingDraftContent,
  type MessagingContentV1,
  type MessagingDraftV1,
  type MessagingPreflightV1,
} from '@/lib/messaging-contracts';
import {
  generateOutreachFromDraftContextV2,
  type GenerateOutreachFromDraftContextV2Input,
  type GeneratedOutreachFromDraftContextV2,
} from '@/ai/flows/generate-outreach-from-report';
import {
  buildDraftContextV2,
  createDefaultDraftWritingStyleV2,
  normalizeDraftSellerProfileV2,
  normalizeDraftWritingStyleV2,
  requiredReportAwareDraftPersonalizationV2,
  type DraftContextBuildResult,
  type DraftContextV2,
  type DraftSellerProfileV2,
  type DraftWritingStyleV2,
} from '@/lib/server/draft-context-v2';
import {
  createFailedDraftPreflightV2,
  draftContentFingerprintV2,
  stripUnapprovedDraftCtasV2,
  validateDraftPreflightV2,
  type DraftPreflightIssueV2,
  type DraftPersonalizationProvenanceV2,
  type GeneratedOutreachV2,
} from '@/lib/server/draft-preflight-v2';
import {
  appendMessagingDraftRevisionV1,
  ensureMessagingDraftV1,
  getCurrentMessagingDraftVersionV1,
  getMessagingDraftVersionV1,
} from '@/lib/server/messaging-drafts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getNativeSnapshot } from '@/lib/server/native-research';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { ResearchSnapshotV1Schema, type ResearchSnapshotV1 } from '@/lib/research-contracts';
import type { ResearchReportDocumentV1 } from '@/lib/research-report-contracts';
import { ensureResearchReportDocument } from '@/lib/server/research-report-documents';

export type NativeDraftAccess = {
  organizationId: string;
  userId: string;
};

export async function resolveNativeDraftOrganization(input: {
  draftId: string;
  userId: string;
  organizationIds: string[];
}) {
  const organizationIds = [...new Set(input.organizationIds.map(text).filter(Boolean))];
  if (organizationIds.length === 0) return null;
  const { data, error } = await getSupabaseAdminClient()
    .from('messaging_drafts')
    .select('organization_id')
    .eq('id', input.draftId)
    .eq('user_id', input.userId)
    .in('organization_id', organizationIds)
    .maybeSingle();
  if (error) throw error;
  return text(data?.organization_id) || null;
}

type NativeSnapshotRow = {
  id?: string;
  payload: unknown;
  content_hash?: unknown;
  captured_at?: unknown;
};

type NativeDraftGenerationClaim = {
  state: 'claimed' | 'busy' | 'suppressed';
  claimToken: string | null;
};

type NativeDraftGenerationMetadata = {
  versionId: string;
  draftId: string;
  styleProfileId: string | null;
  claimIds: string[];
};

type NativeDraftGenerationMetadataInput = NativeDraftGenerationMetadata & NativeDraftAccess & {
  researchSnapshotId: string;
  generationMethod: 'model' | 'human';
  provider: string | null;
  model: string | null;
  promptVersion: string;
};

export type NativeDraftBlockedCode =
  | 'recipient_missing'
  | 'research_artifact_missing'
  | 'research_artifact_invalid'
  | 'research_not_ready'
  | 'research_stale'
  | 'evidence_insufficient'
  | 'quality_below_threshold'
  | 'draft_preflight_failed';

export type NativeDraftFailureCode =
  | 'openai_generation_failed'
  | 'openai_rewrite_failed'
  | 'generation_metadata_persist_failed';

export type NativeDraftGenerationResult =
  | {
    status: 'drafted';
    draft: MessagingDraftV1;
    context: DraftContextV2;
    preflight: MessagingPreflightV1;
    issues: DraftPreflightIssueV2[];
    generation: { provider: 'openai'; model: string; promptVersion: 'native-draft/v2' };
  }
  | {
    status: 'blocked';
    draft: null;
    context: DraftContextV2;
    code: NativeDraftBlockedCode;
    message: string;
    retryable: false;
    preflight: MessagingPreflightV1;
    issues: DraftPreflightIssueV2[];
  }
  | {
    status: 'failed';
    draft: null;
    context: DraftContextV2;
    code: NativeDraftFailureCode;
    message: string;
    retryable: true;
    preflight: MessagingPreflightV1;
    issues: DraftPreflightIssueV2[];
  };

export type NativeDraftGenerationDependencies = {
  getSnapshot?: (input: { snapshotId: string; access: NativeDraftAccess }) => Promise<NativeSnapshotRow | null>;
  loadSellerProfile?: (userId: string) => Promise<DraftSellerProfileV2>;
  loadWritingStyle?: (input: NativeDraftAccess & { styleProfileId?: string | null; styleName?: string | null }) => Promise<DraftWritingStyleV2>;
  ensureReportDocument?: (input: {
    snapshot: ResearchSnapshotV1;
    access: NativeDraftAccess;
    generatedAt?: string;
  }) => Promise<ResearchReportDocumentV1>;
  claimGeneration?: (input: NativeDraftAccess & { draftId: string; snapshotId: string; email: string }) => Promise<NativeDraftGenerationClaim>;
  releaseGeneration?: (input: NativeDraftAccess & { draftId: string; claimToken: string }) => Promise<boolean>;
  isSuppressed?: (email: string, access: NativeDraftAccess) => Promise<boolean>;
  findPersistedDraft?: (input: NativeDraftAccess & { draftId: string; versionId: string }) => Promise<MessagingDraftV1 | null>;
  findExistingContentFingerprints?: (input: NativeDraftAccess & { email: string; excludeVersionId?: string | null }) => Promise<string[]>;
  generate?: (input: GenerateOutreachFromDraftContextV2Input) => Promise<GeneratedOutreachFromDraftContextV2>;
  persistDraft?: (draft: MessagingDraftV1) => Promise<MessagingDraftV1>;
  appendRevision?: (draft: MessagingDraftV1, changes: { content: MessagingContentV1 }) => Promise<MessagingDraftV1>;
  persistMetadata?: (input: NativeDraftGenerationMetadataInput) => Promise<void>;
  replaceMetadata?: (input: NativeDraftGenerationMetadataInput) => Promise<void>;
  loadMetadata?: (input: NativeDraftAccess & { versionId: string }) => Promise<NativeDraftGenerationMetadata | null>;
  now?: () => Date;
};

export class NativeDraftPreflightError extends Error {
  constructor(
    public readonly preflight: MessagingPreflightV1,
    public readonly issues: DraftPreflightIssueV2[] = [],
  ) {
    super(preflight.errors.join(' ') || 'NATIVE_DRAFT_PREFLIGHT_FAILED');
    this.name = 'NativeDraftPreflightError';
  }
}

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeNativeDraftBody(value: unknown) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function unique(values: string[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

async function loadSellerProfile(userId: string): Promise<DraftSellerProfileV2> {
  const { data } = await getSupabaseAdminClient()
    .from('profiles')
    .select('full_name,job_title,company_name,company_domain,signatures')
    .eq('id', userId)
    .maybeSingle();
  const profile: any = data || {};
  const extended = object(profile.signatures?.profile_extended);
  return normalizeDraftSellerProfileV2({
    name: profile.full_name || null,
    jobTitle: profile.job_title || null,
    companyName: profile.company_name || profile.full_name || 'Mi empresa',
    companyDomain: profile.company_domain || null,
    sector: extended.sector || extended.industry || null,
    description: extended.description || null,
    services: extended.services || [],
    valueProposition: extended.valueProposition || extended.value_proposition || null,
    proofPoints: extended.proofPoints || extended.proof_points || [],
  });
}

async function loadServerWritingStyle(input: NativeDraftAccess & {
  styleProfileId?: string | null;
  styleName?: string | null;
}): Promise<DraftWritingStyleV2> {
  const admin = getSupabaseAdminClient();
  const fields = 'id,name,profile,content_hash,revision,is_default';
  const styleProfileId = text(input.styleProfileId);
  const styleName = text(input.styleName);
  const base = () => admin
    .from('email_style_profiles')
    .select(fields)
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId);

  const result = styleProfileId
    ? await base().eq('id', styleProfileId).maybeSingle()
    : styleName
      ? await base().eq('name', styleName).maybeSingle()
      : await base().eq('is_default', true).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    if (styleProfileId || styleName) throw new Error('NATIVE_DRAFT_STYLE_NOT_FOUND');
    return createDefaultDraftWritingStyleV2();
  }
  return normalizeDraftWritingStyleV2({
    id: result.data.id,
    name: result.data.name,
    profile: result.data.profile,
    contentHash: result.data.content_hash,
    revision: result.data.revision,
  });
}

async function claimNativeDraftGeneration(input: NativeDraftAccess & {
  draftId: string;
  snapshotId: string;
  email: string;
}): Promise<NativeDraftGenerationClaim> {
  const { data, error } = await getSupabaseAdminClient().rpc('claim_native_draft_generation_v1', {
    p_draft_id: input.draftId,
    p_research_snapshot_id: input.snapshotId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_subject_email: input.email,
    p_stale_after_seconds: 900,
  });
  if (error) throw error;

  const state = text(object(data).state) as NativeDraftGenerationClaim['state'];
  const claimToken = text(object(data).claimToken) || null;
  if (!['claimed', 'busy', 'suppressed'].includes(state)) {
    throw new Error('INVALID_NATIVE_DRAFT_GENERATION_CLAIM_RESPONSE');
  }
  if (state === 'claimed' && !claimToken) {
    throw new Error('NATIVE_DRAFT_GENERATION_CLAIM_TOKEN_MISSING');
  }
  return { state, claimToken };
}

async function releaseNativeDraftGeneration(input: NativeDraftAccess & { draftId: string; claimToken: string }) {
  const { data, error } = await getSupabaseAdminClient().rpc('release_native_draft_generation_claim_v1', {
    p_draft_id: input.draftId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_claim_token: input.claimToken,
  });
  if (error) throw error;
  return data === true;
}

async function findExistingNativeDraftContentFingerprints(input: NativeDraftAccess & {
  email: string;
  excludeVersionId?: string | null;
}) {
  const { data, error } = await getSupabaseAdminClient()
    .from('messaging_draft_versions')
    .select('id,content')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('recipient->>email', input.email)
    .limit(50);
  if (error) throw error;
  return (data || []).flatMap((row: any) => {
    if (text(row.id) === text(input.excludeVersionId)) return [];
    const content = object(row.content);
    const subject = text(content.subject);
    const body = text(content.text || content.html);
    return subject && body ? [draftContentFingerprintV2(subject, body)] : [];
  });
}

async function persistNativeDraftMetadata(input: NativeDraftGenerationMetadataInput) {
  const client = getSupabaseAdminClient();
  const payload = {
    version_id: input.versionId,
    draft_id: input.draftId,
    organization_id: input.organizationId,
    user_id: input.userId,
    research_snapshot_id: input.researchSnapshotId,
    generation_method: input.generationMethod,
    provider: input.provider,
    model: input.model,
    prompt_version: input.promptVersion,
    style_profile_id: input.styleProfileId,
    claim_ids: input.claimIds,
  };
  const { error } = await client.from('messaging_draft_generation_metadata').upsert(payload, {
    onConflict: 'version_id',
    ignoreDuplicates: true,
  });
  if (error) throw error;
  const { data: persisted, error: readError } = await client
    .from('messaging_draft_generation_metadata')
    .select('version_id,draft_id,organization_id,user_id,research_snapshot_id,generation_method,provider,model,prompt_version,style_profile_id,claim_ids')
    .eq('version_id', input.versionId)
    .maybeSingle();
  if (readError) throw readError;
  const sameIdentity = persisted
    && text(persisted.version_id) === input.versionId
    && text(persisted.draft_id) === input.draftId
    && text(persisted.organization_id) === input.organizationId
    && text(persisted.user_id) === input.userId
    && text(persisted.research_snapshot_id) === input.researchSnapshotId
    && text(persisted.generation_method) === input.generationMethod
    && (text(persisted.provider) || null) === input.provider
    && (text(persisted.model) || null) === input.model
    && text(persisted.prompt_version) === input.promptVersion
    && (text(persisted.style_profile_id) || null) === input.styleProfileId
    && JSON.stringify(unique(strings(persisted.claim_ids)).sort()) === JSON.stringify(unique(input.claimIds).sort());
  if (!sameIdentity) throw new Error('NATIVE_DRAFT_METADATA_CONFLICT');
}

async function replaceNativeDraftMetadata(input: NativeDraftGenerationMetadataInput) {
  const { data, error } = await getSupabaseAdminClient()
    .from('messaging_draft_generation_metadata')
    .update({
      research_snapshot_id: input.researchSnapshotId,
      generation_method: input.generationMethod,
      provider: input.provider,
      model: input.model,
      prompt_version: input.promptVersion,
      style_profile_id: input.styleProfileId,
      claim_ids: unique(input.claimIds),
    })
    .eq('version_id', input.versionId)
    .eq('draft_id', input.draftId)
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .select('version_id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('NATIVE_DRAFT_METADATA_PERSIST_FAILED');
}

async function loadNativeDraftMetadata(input: NativeDraftAccess & {
  versionId: string;
}): Promise<NativeDraftGenerationMetadata | null> {
  const { data, error } = await getSupabaseAdminClient()
    .from('messaging_draft_generation_metadata')
    .select('version_id,draft_id,style_profile_id,claim_ids')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('version_id', input.versionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    versionId: text(data.version_id),
    draftId: text(data.draft_id),
    styleProfileId: text(data.style_profile_id) || null,
    claimIds: unique(strings(data.claim_ids)),
  };
}

function failureResult(input: {
  context: DraftContextV2;
  code: NativeDraftFailureCode;
  message: string;
  errors?: string[];
  issues?: DraftPreflightIssueV2[];
  now: Date;
}): NativeDraftGenerationResult {
  const issues = input.issues || [];
  return {
    status: 'failed',
    draft: null,
    context: input.context,
    code: input.code,
    message: input.message,
    retryable: true,
    preflight: createFailedDraftPreflightV2(
      input.errors || (issues.length > 0 ? issues.map((issue) => issue.message) : [input.message]),
      input.context.warnings,
      input.now,
    ),
    issues,
  };
}

function blockedResult(input: {
  context: DraftContextV2;
  code: NativeDraftBlockedCode;
  message: string;
  errors?: string[];
  issues?: DraftPreflightIssueV2[];
  now: Date;
}): NativeDraftGenerationResult {
  const issues = input.issues || [];
  return {
    status: 'blocked',
    draft: null,
    context: input.context,
    code: input.code,
    message: input.message,
    retryable: false,
    preflight: createFailedDraftPreflightV2(
      input.errors || (issues.length > 0 ? issues.map((issue) => issue.message) : [input.message]),
      input.context.warnings,
      input.now,
    ),
    issues,
  };
}

function contextBlockResult(result: Extract<DraftContextBuildResult, { status: 'blocked' }>, now: Date) {
  return blockedResult({
    context: result.context,
    code: result.reason,
    message: result.message,
    now,
  });
}

function provenanceForClaimIds(context: DraftContextV2, claimIds: string[]): DraftPersonalizationProvenanceV2[] {
  const provenance: DraftPersonalizationProvenanceV2[] = [];
  for (const claimId of unique(claimIds)) {
    const evidence = context.evidence.find((item) => item.supportedFactClaimIds.includes(claimId));
    if (!evidence) continue;
    provenance.push({
      evidenceId: evidence.evidenceId,
      claimId,
      sourceUrl: evidence.source.url,
    });
  }
  return provenance.slice(0, 3);
}

function outputForPersistedDraft(input: {
  draft: MessagingDraftV1;
  context: DraftContextV2;
  metadata: NativeDraftGenerationMetadata;
}): GeneratedOutreachV2 {
  const body = normalizeNativeDraftBody(input.draft.content.text || input.draft.content.html);
  const hypothesisIds = input.metadata.claimIds.filter((claimId) =>
    input.context.hypotheses.some((hypothesis) => hypothesis.claimId === claimId),
  );
  return {
    subject: text(input.draft.content.subject),
    body,
    personalization: provenanceForClaimIds(input.context, input.metadata.claimIds),
    hypothesisIds,
  };
}

function outputForPreflight(
  context: DraftContextV2,
  generated: GeneratedOutreachFromDraftContextV2,
): GeneratedOutreachV2 {
  const approvedCta = context.constraints.cta.exactText;
  const modelBody = stripUnapprovedDraftCtasV2(normalizeNativeDraftBody(generated.body), approvedCta);
  return {
    subject: generated.subject,
    body: normalizeNativeDraftBody(`${modelBody}\n\n${approvedCta}`),
    personalization: requiredReportAwareDraftPersonalizationV2(context),
    hypothesisIds: generated.hypothesisIds,
  };
}

async function createDraftContext(input: {
  access: NativeDraftAccess;
  snapshotRow: NativeSnapshotRow;
  styleProfileId?: string | null;
  styleName?: string | null;
  dependencies?: NativeDraftGenerationDependencies;
  now: Date;
}) {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshotRow.payload);
  const ensureReportDocument = input.dependencies?.ensureReportDocument || (async (request: {
    snapshot: ResearchSnapshotV1;
    access: NativeDraftAccess;
    generatedAt?: string;
  }) => (await ensureResearchReportDocument(request)).document);
  const [seller, style, reportDocument] = await Promise.all([
    input.dependencies?.loadSellerProfile?.(input.access.userId) || loadSellerProfile(input.access.userId),
    input.dependencies?.loadWritingStyle?.({
      ...input.access,
      styleProfileId: input.styleProfileId,
      styleName: input.styleName,
    }) || loadServerWritingStyle({
      ...input.access,
      styleProfileId: input.styleProfileId,
      styleName: input.styleName,
    }),
    snapshot.subject.email
      ? ensureReportDocument({
        snapshot,
        access: input.access,
        generatedAt: input.now.toISOString(),
      })
      : Promise.resolve(null),
  ]);
  return {
    snapshot,
    style,
    result: buildDraftContextV2({
      snapshot,
      artifact: {
        contentHash: text(input.snapshotRow.content_hash) || null,
        capturedAt: text(input.snapshotRow.captured_at) || null,
      },
      seller,
      style,
      reportDocument,
      now: input.now,
    }),
  };
}

export async function getCurrentNativeDraft(input: NativeDraftAccess & { draftId: string }) {
  const draft = await getCurrentMessagingDraftVersionV1({
    organizationId: input.organizationId,
    userId: input.userId,
    draftId: input.draftId,
  });
  return draft ? MessagingDraftV1Schema.parse(draft) : null;
}

export async function createNativeDraft(input: NativeDraftAccess & {
  snapshotId: string;
  styleProfileId?: string | null;
  styleName?: string | null;
  idempotencyKey?: string | null;
}, dependencies?: NativeDraftGenerationDependencies): Promise<NativeDraftGenerationResult> {
  const now = dependencies?.now?.() || new Date();
  const snapshotRow = await (dependencies?.getSnapshot?.({ snapshotId: input.snapshotId, access: input })
    || getNativeSnapshot({ snapshotId: input.snapshotId, access: input }));
  if (!snapshotRow?.payload) throw new Error('NATIVE_RESEARCH_SNAPSHOT_NOT_FOUND');
  const parsedSnapshot = ResearchSnapshotV1Schema.parse(snapshotRow.payload);
  const snapshotEmail = text(parsedSnapshot.subject.email).toLowerCase();
  const isSuppressed = dependencies?.isSuppressed || ((value, access) => isEmailSuppressedForScope(value, access));
  if (snapshotEmail && await isSuppressed(snapshotEmail, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');
  const { snapshot, style, result: contextResult } = await createDraftContext({
    access: input,
    snapshotRow,
    styleProfileId: input.styleProfileId,
    styleName: input.styleName,
    dependencies,
    now,
  });
  if (contextResult.status === 'blocked') return contextBlockResult(contextResult, now);
  const context = contextResult.context;
  const email = text(context.recipient.email).toLowerCase();
  if (!email) return blockedResult({
    context,
    code: 'recipient_missing',
    message: 'La investigación no tiene un email válido para crear un borrador.',
    now,
  });

  if (await isSuppressed(email, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');
  const identity = canonicalSha256({
    schemaVersion: 'native-draft/v2',
    idempotencyKey: text(input.idempotencyKey) || null,
    snapshotId: snapshot.id,
    snapshotHash: context.research.contentHash,
    recipientEmail: email,
    styleHash: style.contentHash,
  });
  const draftId = deterministicMessagingUuid(`native-draft:${input.organizationId}:${input.userId}:${identity}`);
  const versionId = deterministicMessagingUuid(`native-version:${input.organizationId}:${input.userId}:${identity}`);
  const findPersistedDraft = dependencies?.findPersistedDraft || ((request) => getMessagingDraftVersionV1(request));
  const existing = await findPersistedDraft({ ...input, draftId, versionId });
  if (existing) {
    return {
      status: 'drafted',
      draft: existing,
      context,
      preflight: existing.preflight,
      issues: [],
      generation: { provider: 'openai', model: 'persisted', promptVersion: 'native-draft/v2' },
    };
  }

  const claimGeneration = dependencies?.claimGeneration || claimNativeDraftGeneration;
  const releaseGeneration = dependencies?.releaseGeneration || releaseNativeDraftGeneration;
  const claim = await claimGeneration({
    organizationId: input.organizationId,
    userId: input.userId,
    draftId,
    snapshotId: input.snapshotId,
    email,
  });
  if (claim.state === 'suppressed') throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');
  if (claim.state === 'busy' || !claim.claimToken) throw new Error('NATIVE_DRAFT_GENERATION_IN_PROGRESS');

  try {
    if (await isSuppressed(email, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');
    const findExistingContentFingerprints = dependencies?.findExistingContentFingerprints || findExistingNativeDraftContentFingerprints;
    const existingContentFingerprints = await findExistingContentFingerprints({ ...input, email });
    const generate = dependencies?.generate || generateOutreachFromDraftContextV2;
    let generated: GeneratedOutreachFromDraftContextV2;
    try {
      generated = await generate({ context });
    } catch (error) {
      console.warn('[native-drafts] OpenAI generation failed:', error);
      return failureResult({
        context,
        code: 'openai_generation_failed',
        message: 'OpenAI no está disponible para generar un borrador verificable.',
        now,
      });
    }

    let generatedOutput = outputForPreflight(context, generated);
    let validation = validateDraftPreflightV2(context, generatedOutput, { existingContentFingerprints, now });
    if (!validation.valid) {
      try {
        generated = await generate({
          context,
          rewrite: {
            previous: generatedOutput,
            errors: validation.issues.map((issue) => issue.message),
          },
        });
      } catch (error) {
        console.warn('[native-drafts] OpenAI rewrite failed:', error);
        return failureResult({
          context,
          code: 'openai_rewrite_failed',
          message: 'OpenAI no pudo corregir el borrador para cumplir los controles requeridos.',
          issues: validation.issues,
          now,
        });
      }
      generatedOutput = outputForPreflight(context, generated);
      validation = validateDraftPreflightV2(context, generatedOutput, { existingContentFingerprints, now });
    }
    if (!validation.valid) {
      return blockedResult({
        context,
        code: 'draft_preflight_failed',
        message: 'El borrador no cumple los controles de evidencia y calidad.',
        issues: validation.issues,
        now,
      });
    }
    if (await isSuppressed(email, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');

    const draft = MessagingDraftV1Schema.parse({
      schemaVersion: 1,
      draftId,
      versionId,
      organizationId: input.organizationId,
      userId: input.userId,
      researchSnapshotId: input.snapshotId,
      revision: 1,
      parentVersionId: null,
      lifecycle: 'draft',
      channel: 'email',
      recipient: {
        leadRef: context.recipient.leadRef,
        displayName: context.recipient.displayName,
        email,
        linkedinUrl: context.person.linkedinUrl,
      },
      content: {
        subject: text(generatedOutput.subject),
        text: generatedOutput.body,
        html: null,
      },
      approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
      preflight: validation.preflight,
      createdAt: now.toISOString(),
    });
    const persistDraft = dependencies?.persistDraft || ensureMessagingDraftV1;
    const persisted = await persistDraft(draft);
    const persistMetadata = dependencies?.persistMetadata || persistNativeDraftMetadata;
    try {
      await persistMetadata({
        versionId: persisted.versionId,
        draftId: persisted.draftId,
        organizationId: input.organizationId,
        userId: input.userId,
        researchSnapshotId: input.snapshotId,
        generationMethod: 'model',
        provider: generated.provider,
        model: generated.model,
        promptVersion: generated.promptVersion,
        styleProfileId: style.id,
        claimIds: unique([
          ...generatedOutput.personalization.map((provenance) => provenance.claimId),
          ...generatedOutput.hypothesisIds,
        ]),
      });
    } catch (error) {
      console.error('[native-drafts] metadata persistence failed:', error);
      return failureResult({
        context,
        code: 'generation_metadata_persist_failed',
        message: 'No se pudo guardar la trazabilidad del borrador; no puede aprobarse ni enviarse.',
        now,
      });
    }
    return {
      status: 'drafted',
      draft: persisted,
      context,
      preflight: validation.preflight,
      issues: [],
      generation: {
        provider: generated.provider,
        model: generated.model,
        promptVersion: generated.promptVersion,
      },
    };
  } finally {
    try {
      const released = await releaseGeneration({
        organizationId: input.organizationId,
        userId: input.userId,
        draftId,
        claimToken: claim.claimToken,
      });
      if (!released) console.error('[native-drafts] generation claim was not released:', { draftId });
    } catch (error) {
      console.error('[native-drafts] generation claim release failed:', error);
    }
  }
}

export async function reviseNativeDraft(input: NativeDraftAccess & {
  draft: MessagingDraftV1;
  subject?: string;
  text?: string;
}) {
  const metadata = await loadNativeDraftMetadata({
    organizationId: input.organizationId,
    userId: input.userId,
    versionId: input.draft.versionId,
  });
  if (!metadata) throw new Error('NATIVE_DRAFT_PROVENANCE_REQUIRED');
  const content: MessagingContentV1 = {
    subject: text(input.subject) || input.draft.content.subject,
    text: normalizeNativeDraftBody(input.text) || input.draft.content.text,
    html: input.draft.content.html,
    ...(input.draft.content.deliveryOptions ? { deliveryOptions: input.draft.content.deliveryOptions } : {}),
  };
  if (hashMessagingDraftContent({ ...input.draft, content }) === hashMessagingDraftContent(input.draft)) {
    return input.draft;
  }
  const persisted = await appendMessagingDraftRevisionV1(input.draft, { content });
  const copiedMetadata = await loadNativeDraftMetadata({
    organizationId: input.organizationId,
    userId: input.userId,
    versionId: persisted.versionId,
  });
  if (
    !copiedMetadata
    || copiedMetadata.draftId !== persisted.draftId
    || copiedMetadata.styleProfileId !== metadata.styleProfileId
    || JSON.stringify(copiedMetadata.claimIds.slice().sort()) !== JSON.stringify(metadata.claimIds.slice().sort())
  ) {
    throw new Error('NATIVE_DRAFT_METADATA_PERSIST_FAILED');
  }
  return persisted;
}

export async function rewriteNativeDraft(input: NativeDraftAccess & {
  draft: MessagingDraftV1;
  instruction: string;
  styleProfileId?: string | null;
}, dependencies?: NativeDraftGenerationDependencies) {
  const instruction = text(input.instruction);
  if (!instruction || instruction.length > 1_000) throw new Error('NATIVE_DRAFT_REWRITE_INSTRUCTION_INVALID');
  if (!input.draft.researchSnapshotId) throw new Error('NATIVE_DRAFT_RESEARCH_SNAPSHOT_REQUIRED');

  const now = dependencies?.now?.() || new Date();
  const loadMetadata = dependencies?.loadMetadata || loadNativeDraftMetadata;
  const metadata = await loadMetadata({ ...input, versionId: input.draft.versionId });
  if (!metadata || metadata.draftId !== input.draft.draftId) {
    throw new Error('NATIVE_DRAFT_PROVENANCE_REQUIRED');
  }
  const snapshotRow = await (dependencies?.getSnapshot?.({
    snapshotId: input.draft.researchSnapshotId,
    access: input,
  }) || getNativeSnapshot({ snapshotId: input.draft.researchSnapshotId, access: input }));
  if (!snapshotRow?.payload) throw new Error('NATIVE_RESEARCH_SNAPSHOT_NOT_FOUND');

  const { style, result: contextResult } = await createDraftContext({
    access: input,
    snapshotRow,
    styleProfileId: input.styleProfileId || metadata.styleProfileId,
    dependencies,
    now,
  });
  if (contextResult.status === 'blocked') {
    throw new NativeDraftPreflightError(contextBlockResult(contextResult, now).preflight);
  }
  const context = contextResult.context;
  const email = text(input.draft.recipient.email).toLowerCase();
  const isSuppressed = dependencies?.isSuppressed || ((value, access) => isEmailSuppressedForScope(value, access));
  if (!email || await isSuppressed(email, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');

  const previous = outputForPersistedDraft({ draft: input.draft, context, metadata });
  const findExistingContentFingerprints = dependencies?.findExistingContentFingerprints || findExistingNativeDraftContentFingerprints;
  const existingContentFingerprints = await findExistingContentFingerprints({
    ...input,
    email,
    excludeVersionId: input.draft.versionId,
  });
  existingContentFingerprints.push(draftContentFingerprintV2(previous.subject, previous.body));
  const generate = dependencies?.generate || generateOutreachFromDraftContextV2;

  let generated: GeneratedOutreachFromDraftContextV2;
  try {
    generated = await generate({ context, rewrite: { previous, errors: [], instruction } });
  } catch (error) {
    console.warn('[native-drafts] OpenAI requested rewrite failed:', error);
    throw new Error('NATIVE_DRAFT_OPENAI_REWRITE_FAILED');
  }
  let generatedOutput = outputForPreflight(context, generated);
  let validation = validateDraftPreflightV2(context, generatedOutput, { existingContentFingerprints, now });
  if (!validation.valid) {
    try {
      generated = await generate({
        context,
        rewrite: {
          previous: generatedOutput,
          errors: validation.issues.map((issue) => issue.message),
          instruction,
        },
      });
    } catch (error) {
      console.warn('[native-drafts] OpenAI corrective rewrite failed:', error);
      throw new Error('NATIVE_DRAFT_OPENAI_REWRITE_FAILED');
    }
    generatedOutput = outputForPreflight(context, generated);
    validation = validateDraftPreflightV2(context, generatedOutput, { existingContentFingerprints, now });
  }
  if (!validation.valid) throw new NativeDraftPreflightError(validation.preflight, validation.issues);
  if (await isSuppressed(email, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');

  const content: MessagingContentV1 = {
    subject: text(generatedOutput.subject),
    text: generatedOutput.body,
    html: null,
    ...(input.draft.content.deliveryOptions ? { deliveryOptions: input.draft.content.deliveryOptions } : {}),
  };
  const appendRevision = dependencies?.appendRevision || ((draft, changes) => appendMessagingDraftRevisionV1(draft, changes));
  const persisted = await appendRevision(input.draft, { content });
  const replaceMetadata = dependencies?.replaceMetadata || replaceNativeDraftMetadata;
  await replaceMetadata({
    versionId: persisted.versionId,
    draftId: persisted.draftId,
    organizationId: input.organizationId,
    userId: input.userId,
    researchSnapshotId: input.draft.researchSnapshotId,
    generationMethod: 'model',
    provider: generated.provider,
    model: generated.model,
    promptVersion: generated.promptVersion,
    styleProfileId: style.id,
    claimIds: unique(generatedOutput.personalization.map((item) => item.claimId)),
  });
  return {
    draft: persisted,
    preflight: validation.preflight,
    generation: {
      provider: generated.provider,
      model: generated.model,
      promptVersion: generated.promptVersion,
    },
  };
}

export async function approveNativeDraft(input: NativeDraftAccess & {
  draftId: string;
  versionId: string;
  warnings?: string[];
}, dependencies?: NativeDraftGenerationDependencies) {
  const current = await getCurrentNativeDraft(input);
  if (!current || current.versionId !== input.versionId) throw new Error('NATIVE_DRAFT_VERSION_NOT_CURRENT');
  if (!current.researchSnapshotId) throw new Error('NATIVE_DRAFT_RESEARCH_SNAPSHOT_REQUIRED');
  const now = dependencies?.now?.() || new Date();
  const snapshotRow = await (dependencies?.getSnapshot?.({ snapshotId: current.researchSnapshotId, access: input })
    || getNativeSnapshot({ snapshotId: current.researchSnapshotId, access: input }));
  if (!snapshotRow?.payload) throw new Error('NATIVE_RESEARCH_SNAPSHOT_NOT_FOUND');
  const loadMetadata = dependencies?.loadMetadata || loadNativeDraftMetadata;
  const metadata = await loadMetadata({ ...input, versionId: current.versionId });
  if (!metadata || metadata.draftId !== current.draftId) {
    throw new Error('NATIVE_DRAFT_PROVENANCE_REQUIRED');
  }
  const { result: contextResult } = await createDraftContext({
    access: input,
    snapshotRow,
    styleProfileId: metadata.styleProfileId,
    dependencies,
    now,
  });
  if (contextResult.status === 'blocked') {
    throw new NativeDraftPreflightError(contextBlockResult(contextResult, now).preflight);
  }
  const context = contextResult.context;
  const email = text(current.recipient.email).toLowerCase();
  const isSuppressed = dependencies?.isSuppressed || ((value, access) => isEmailSuppressedForScope(value, access));
  if (!email || await isSuppressed(email, input)) throw new Error('NATIVE_DRAFT_PRIVACY_SUPPRESSED');
  const findExistingContentFingerprints = dependencies?.findExistingContentFingerprints || findExistingNativeDraftContentFingerprints;
  const existingContentFingerprints = await findExistingContentFingerprints({
    ...input,
    email,
    excludeVersionId: current.versionId,
  });
  const validation = validateDraftPreflightV2(
    context,
    outputForPersistedDraft({ draft: current, context, metadata }),
    { existingContentFingerprints, now },
  );
  if (!validation.valid) throw new NativeDraftPreflightError(validation.preflight, validation.issues);

  const warnings = unique([...(validation.preflight.warnings || []), ...(input.warnings || [])]).slice(0, 100);
  const { data, error } = await getSupabaseAdminClient().rpc('approve_messaging_draft_v1', {
    p_draft_id: input.draftId,
    p_version_id: input.versionId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_warnings: warnings,
  });
  if (error) throw error;
  const payload = data && typeof data === 'object' && 'payload' in data ? (data as any).payload : data;
  return MessagingDraftV1Schema.parse(payload);
}

export function isNativeDraftVersionConflict(error: unknown) {
  const details = object(error);
  const code = text(details.code);
  const message = text(details.message).toLowerCase();
  return code === '40001'
    || code === '40400'
    || message.includes('expected parent version')
    || message.includes('stale messaging draft parent')
    || message.includes('is not current');
}
