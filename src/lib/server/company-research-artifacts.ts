import { createHash } from 'node:crypto';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const COMPANY_RESEARCH_ARTIFACT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPANY_RESEARCH_INSUFFICIENT_TTL_MS = 24 * 60 * 60 * 1000;
export const NATIVE_COMPANY_RESEARCH_PROFILE_REVISION = 'native-seller-profile/v2';
export const NATIVE_COMPANY_RESEARCH_ICP_HASH = createHash('sha256')
  .update('native-research-default-icp/v1', 'utf8')
  .digest('hex');
export const NATIVE_COMPANY_RESEARCH_PROMPT_VERSION = 'native-research-prompt/v3';
export const NATIVE_COMPANY_RESEARCH_PROVIDER = 'native-research-v1';
export const NATIVE_COMPANY_RESEARCH_PROVIDER_VERSION = 'native-research-provider/v2';

export type CompanyResearchArtifactStatus = 'queued' | 'running' | 'completed' | 'partial' | 'insufficient_data' | 'failed' | 'cancelled';

export type CompanyResearchArtifactIdentity = {
  organizationId: string;
  cacheIdentity: string;
  companyIdentity: string;
  countryCode: string;
  researchDepth: 'basic' | 'standard' | 'deep';
  researchLanguage: string;
  profileRevision: string;
  icpHash: string;
  promptVersion: string;
  provider: string;
  providerVersion: string;
};

export type CompanyResearchArtifact = CompanyResearchArtifactIdentity & {
  id: string;
  revision: number;
  status: CompanyResearchArtifactStatus;
  payload: Record<string, any>;
  expiresAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  errorMetadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type CompanyResearchArtifactClaim = {
  state: 'claimed' | 'cached' | 'busy';
  artifact: CompanyResearchArtifact;
  claimToken: string | null;
};

type CompanyResearchArtifactIdentityInput = {
  organizationId: string;
  companyDomain?: string | null;
  companyName?: string | null;
  countryCode?: string | null;
  researchDepth?: string | null;
  researchLanguage?: string | null;
  profileRevision?: string | null;
  icpHash?: string | null;
  promptVersion?: string | null;
  provider?: string | null;
  providerVersion?: string | null;
  providerContextFingerprint?: string | null;
};

const reusableStatuses = new Set<CompanyResearchArtifactStatus>(['completed', 'partial', 'insufficient_data']);
const artifactStatuses = new Set<CompanyResearchArtifactStatus>([
  'queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled',
]);

function text(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeCompanyName(value: unknown) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeCompanyResearchDomain(value: unknown) {
  const raw = text(value).toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`)
      .hostname
      .replace(/\.$/, '')
      .replace(/^www\./, '')
      .replace(/^m\./, '');
  } catch {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/^m\./, '')
      .split('/')[0]
      .split(':')[0]
      .trim();
  }
}

function normalizeCountryCode(value: unknown) {
  const normalized = normalizeCompanyName(value);
  return normalized || 'cl';
}

function normalizeLanguage(value: unknown) {
  const normalized = text(value).toLowerCase().replace(/_/g, '-');
  return /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(normalized) ? normalized : 'es';
}

function normalizeDepth(value: unknown): CompanyResearchArtifactIdentity['researchDepth'] {
  const normalized = text(value).toLowerCase();
  return normalized === 'basic' || normalized === 'deep' ? normalized : 'standard';
}

function normalizeVersion(value: unknown, fallback: string, label: string) {
  const normalized = text(value) || fallback;
  if (normalized.length > 160) throw new Error(`${label}_TOO_LONG`);
  return normalized;
}

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildCompanyResearchArtifactIdentity(input: CompanyResearchArtifactIdentityInput): CompanyResearchArtifactIdentity {
  const organizationId = text(input.organizationId).toLowerCase();
  const domain = normalizeCompanyResearchDomain(input.companyDomain);
  const companyName = normalizeCompanyName(input.companyName);
  const companyIdentity = domain ? `domain:${domain}` : companyName ? `name:${companyName}` : '';
  if (!organizationId) throw new Error('COMPANY_RESEARCH_ORGANIZATION_REQUIRED');
  if (!companyIdentity) throw new Error('COMPANY_RESEARCH_COMPANY_IDENTITY_REQUIRED');

  const identity = {
    organizationId,
    companyIdentity,
    countryCode: normalizeCountryCode(input.countryCode),
    researchDepth: normalizeDepth(input.researchDepth),
    researchLanguage: normalizeLanguage(input.researchLanguage),
    profileRevision: normalizeVersion(input.profileRevision, NATIVE_COMPANY_RESEARCH_PROFILE_REVISION, 'COMPANY_RESEARCH_PROFILE_REVISION'),
    icpHash: normalizeVersion(input.icpHash, NATIVE_COMPANY_RESEARCH_ICP_HASH, 'COMPANY_RESEARCH_ICP_HASH'),
    promptVersion: normalizeVersion(input.promptVersion, NATIVE_COMPANY_RESEARCH_PROMPT_VERSION, 'COMPANY_RESEARCH_PROMPT_VERSION'),
    provider: normalizeVersion(input.provider, NATIVE_COMPANY_RESEARCH_PROVIDER, 'COMPANY_RESEARCH_PROVIDER'),
    providerVersion: normalizeVersion(input.providerVersion, NATIVE_COMPANY_RESEARCH_PROVIDER_VERSION, 'COMPANY_RESEARCH_PROVIDER_VERSION'),
  };
  const providerContextFingerprint = normalizeVersion(
    input.providerContextFingerprint,
    'none',
    'COMPANY_RESEARCH_PROVIDER_CONTEXT_FINGERPRINT',
  );

  return {
    ...identity,
    cacheIdentity: digest(JSON.stringify({
      schemaVersion: 'research-company-artifact/v2',
      ...identity,
      providerContextFingerprint,
    })),
  };
}

function mapArtifact(value: unknown): CompanyResearchArtifact | null {
  const row = object(value);
  const status = text(row.status).toLowerCase() as CompanyResearchArtifactStatus;
  const revision = Number(row.revision);
  const id = text(row.id);
  const organizationId = text(row.organization_id).toLowerCase();
  const cacheIdentity = text(row.cache_identity).toLowerCase();
  const companyIdentity = text(row.company_identity);
  const expiresAt = text(row.expires_at);
  if (!id || !organizationId || !/^[a-f0-9]{64}$/.test(cacheIdentity) || !companyIdentity
    || !artifactStatuses.has(status) || !Number.isInteger(revision) || revision < 1 || !expiresAt) {
    return null;
  }

  return {
    id,
    organizationId,
    cacheIdentity,
    companyIdentity,
    countryCode: text(row.country_code).toLowerCase(),
    researchDepth: normalizeDepth(row.research_depth),
    researchLanguage: text(row.research_language).toLowerCase(),
    profileRevision: text(row.profile_revision),
    icpHash: text(row.icp_hash),
    promptVersion: text(row.prompt_version),
    provider: text(row.provider),
    providerVersion: text(row.provider_version),
    revision,
    status,
    payload: object(row.payload),
    expiresAt,
    errorCode: text(row.error_code) || null,
    errorMessage: text(row.error_message) || null,
    errorMetadata: object(row.error_metadata),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    completedAt: text(row.completed_at) || null,
  };
}

export function matchesCompanyResearchArtifactIdentity(
  artifact: CompanyResearchArtifact,
  identity: CompanyResearchArtifactIdentity,
) {
  return artifact.organizationId === identity.organizationId
    && artifact.cacheIdentity === identity.cacheIdentity
    && artifact.companyIdentity === identity.companyIdentity
    && artifact.countryCode === identity.countryCode
    && artifact.researchDepth === identity.researchDepth
    && artifact.researchLanguage === identity.researchLanguage
    && artifact.profileRevision === identity.profileRevision
    && artifact.icpHash === identity.icpHash
    && artifact.promptVersion === identity.promptVersion
    && artifact.provider === identity.provider
    && artifact.providerVersion === identity.providerVersion;
}

export function isFreshReusableCompanyResearchArtifact(
  artifact: CompanyResearchArtifact,
  identity: CompanyResearchArtifactIdentity,
  now = Date.now(),
) {
  const expiresAt = Date.parse(artifact.expiresAt);
  return matchesCompanyResearchArtifactIdentity(artifact, identity)
    && reusableStatuses.has(artifact.status)
    && Number.isFinite(expiresAt)
    && expiresAt > now;
}

export function parseCompanyResearchArtifactClaim(
  value: unknown,
  identity: CompanyResearchArtifactIdentity,
): CompanyResearchArtifactClaim {
  const result = object(value);
  const state = text(result.state) as CompanyResearchArtifactClaim['state'];
  const artifact = mapArtifact(result.artifact);
  const claimToken = text(result.claim_token) || null;
  if (!artifact || !matchesCompanyResearchArtifactIdentity(artifact, identity)) {
    throw new Error('INVALID_COMPANY_RESEARCH_ARTIFACT_CLAIM_RESPONSE');
  }
  if (state === 'claimed' && claimToken) return { state, artifact, claimToken };
  if (state === 'cached' && isFreshReusableCompanyResearchArtifact(artifact, identity)) {
    return { state, artifact, claimToken: null };
  }
  if (state === 'busy' && artifact.status === 'running') return { state, artifact, claimToken: null };
  throw new Error('INVALID_COMPANY_RESEARCH_ARTIFACT_CLAIM_RESPONSE');
}

export async function claimCompanyResearchArtifact(
  input: {
    identity: CompanyResearchArtifactIdentity;
    forceRefresh?: boolean;
    leaseSeconds?: number;
  },
  admin: any = getSupabaseAdminClient(),
): Promise<CompanyResearchArtifactClaim> {
  const leaseSeconds = Math.max(60, Math.min(3600, Math.trunc(Number(input.leaseSeconds) || 300)));
  const { data, error } = await admin.rpc('claim_research_company_artifact_v1', {
    p_organization_id: input.identity.organizationId,
    p_cache_identity: input.identity.cacheIdentity,
    p_company_identity: input.identity.companyIdentity,
    p_country_code: input.identity.countryCode,
    p_research_depth: input.identity.researchDepth,
    p_research_language: input.identity.researchLanguage,
    p_profile_revision: input.identity.profileRevision,
    p_icp_hash: input.identity.icpHash,
    p_prompt_version: input.identity.promptVersion,
    p_provider: input.identity.provider,
    p_provider_version: input.identity.providerVersion,
    p_force_refresh: Boolean(input.forceRefresh),
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return parseCompanyResearchArtifactClaim(data, input.identity);
}

export async function completeCompanyResearchArtifact(
  input: {
    artifact: CompanyResearchArtifact;
    identity: CompanyResearchArtifactIdentity;
    claimToken: string;
    status: Extract<CompanyResearchArtifactStatus, 'completed' | 'partial' | 'insufficient_data'>;
    payload: Record<string, any>;
    expiresAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    errorMetadata?: Record<string, any>;
  },
  admin: any = getSupabaseAdminClient(),
) {
  if (!matchesCompanyResearchArtifactIdentity(input.artifact, input.identity)) {
    throw new Error('COMPANY_RESEARCH_ARTIFACT_IDENTITY_MISMATCH');
  }
  const { data, error } = await admin.rpc('complete_research_company_artifact_v1', {
    p_artifact_id: input.artifact.id,
    p_organization_id: input.identity.organizationId,
    p_cache_identity: input.identity.cacheIdentity,
    p_claim_token: input.claimToken,
    p_status: input.status,
    p_payload: object(input.payload),
    p_expires_at: input.expiresAt,
    p_error_code: input.errorCode || null,
    p_error_message: input.errorMessage || null,
    p_error_metadata: object(input.errorMetadata),
  });
  if (error) throw error;
  const artifact = mapArtifact(data);
  if (!artifact || !matchesCompanyResearchArtifactIdentity(artifact, input.identity)) {
    throw new Error('INVALID_COMPANY_RESEARCH_ARTIFACT_COMPLETION_RESPONSE');
  }
  return artifact;
}

export async function releaseCompanyResearchArtifactClaim(
  input: {
    artifact: CompanyResearchArtifact;
    identity: CompanyResearchArtifactIdentity;
    claimToken: string;
    errorCode: string;
    errorMessage: string;
    errorMetadata?: Record<string, any>;
  },
  admin: any = getSupabaseAdminClient(),
) {
  if (!matchesCompanyResearchArtifactIdentity(input.artifact, input.identity)) {
    throw new Error('COMPANY_RESEARCH_ARTIFACT_IDENTITY_MISMATCH');
  }
  const { data, error } = await admin.rpc('release_research_company_artifact_claim_v1', {
    p_artifact_id: input.artifact.id,
    p_organization_id: input.identity.organizationId,
    p_cache_identity: input.identity.cacheIdentity,
    p_claim_token: input.claimToken,
    p_error_code: text(input.errorCode),
    p_error_message: text(input.errorMessage),
    p_error_metadata: object(input.errorMetadata),
  });
  if (error) throw error;
  return data === true;
}
