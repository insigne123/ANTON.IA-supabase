import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { normalizeDomain } from '@/lib/domain';
import {
  ApolloOrganizationEnrichmentError,
  assertApolloOrganizationEnrichmentConfigured,
  submitApolloOrganizationEnrichment,
} from '@/lib/server/apollo-organization-enrichment';
import {
  getFreshApolloOrganizationContext,
  persistApolloOrganizationContext,
  sanitizeApolloOrganizationContext,
} from '@/lib/server/apollo-organization-context';
import {
  claimEnrichmentQuotaOperation,
  completeEnrichmentQuotaOperation,
  getEffectiveDailyQuotaLimits,
  getEnrichmentQuotaOperation,
  markEnrichmentQuotaOperationSubmitted,
  releaseEnrichmentQuotaOperation,
  type EnrichmentQuotaOperationClaim,
} from '@/lib/server/daily-quota-store';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function text(value: unknown, maxLength: number) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : '';
}

function operationResponse(claim: EnrichmentQuotaOperationClaim) {
  if (claim.responsePayload && claim.responseStatus) {
    const response = NextResponse.json({
      ...claim.responsePayload,
      operationId: claim.operationId,
      operationStatus: claim.status,
      usage: { consumed: claim.consumed, count: claim.count, limit: claim.limit, reused: true },
    }, { status: claim.responseStatus });
    response.headers.set('x-idempotent-replay', 'true');
    return response;
  }
  if (!claim.allowed) {
    return NextResponse.json({
      error: 'DAILY_ENRICHMENT_QUOTA_EXCEEDED',
      count: claim.count,
      limit: claim.limit,
      retryAt: claim.resetAtISO,
    }, { status: 429 });
  }
  return NextResponse.json({
    error: claim.providerState === 'unknown'
      ? 'APOLLO_ORGANIZATION_OUTCOME_UNKNOWN'
      : 'APOLLO_ORGANIZATION_ENRICHMENT_PROCESSING',
    operationId: claim.operationId,
    operationStatus: claim.status,
    providerState: claim.providerState,
  }, { status: claim.providerState === 'unknown' ? 409 : 202 });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth();
  } catch (error) {
    return handleAuthError(error);
  }
  const { user, organizationId } = auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const domain = normalizeDomain(text(body.domain, 500));
  if (!domain || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    return NextResponse.json({ error: 'INVALID_ORGANIZATION_DOMAIN' }, { status: 400 });
  }
  const operationCandidates = [
    request.headers.get('idempotency-key'),
    request.headers.get('x-idempotency-key'),
    body.operationId,
  ].map((value) => text(value, 200)).filter(Boolean);
  const operationIds = [...new Set(operationCandidates)];
  if (operationIds.length !== 1) {
    return NextResponse.json({ error: operationIds.length ? 'IDEMPOTENCY_KEY_CONFLICT' : 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  }

  const operationId = operationIds[0];
  const requestFingerprint = createHash('sha256').update(JSON.stringify({ version: 1, domain })).digest('hex');
  const existing = await getEnrichmentQuotaOperation({
    userId: user.id,
    organizationId,
    resource: 'enrich',
    operationId,
    requestFingerprint,
  });
  if (existing) return operationResponse(existing);

  const cached = await getFreshApolloOrganizationContext({
    userId: user.id,
    organizationId,
    domain,
  });
  if (cached) {
    return NextResponse.json({
      provider: 'apollo',
      status: 'completed',
      organization: cached.organization,
      observedAt: cached.observedAt,
      cached: true,
      operationId,
      operationStatus: 'completed',
      usage: { consumed: 0, reused: true },
    }, { status: 200, headers: { 'Cache-Control': 'private, no-store', 'x-context-cache': 'hit' } });
  }

  try {
    assertApolloOrganizationEnrichmentConfigured();
  } catch (error) {
    if (error instanceof ApolloOrganizationEnrichmentError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }

  const limits = await getEffectiveDailyQuotaLimits({ userId: user.id, organizationId });
  const claim = await claimEnrichmentQuotaOperation({
    userId: user.id,
    organizationId,
    resource: 'enrich',
    operationId,
    requestFingerprint,
    limit: limits.enrich,
    count: 1,
  });
  if (!claim.claimed || !claim.allowed || !claim.claimToken) return operationResponse(claim);

  const identity = {
    userId: user.id,
    organizationId,
    resource: 'enrich' as const,
    operationId,
    claimToken: claim.claimToken,
  };
  let providerBoundaryCrossed = false;
  try {
    await markEnrichmentQuotaOperationSubmitted(identity);
    providerBoundaryCrossed = true;
    const payload = await submitApolloOrganizationEnrichment({ domain, requestId: operationId });
    const observedAt = new Date().toISOString();
    const organization = sanitizeApolloOrganizationContext(payload, domain);
    if (payload.status === 'completed' && !organization) {
      throw new ApolloOrganizationEnrichmentError(502, 'APOLLO_ORGANIZATION_INVALID_RESPONSE', true);
    }
    const responsePayload = {
      provider: 'apollo',
      status: organization ? 'completed' : 'no_data',
      ...(organization ? { organization, observedAt } : {}),
      operationId,
      operationStatus: 'completed',
    };
    if (organization) {
      await persistApolloOrganizationContext({
        ...identity,
        organization,
        observedAt,
        responsePayload,
      });
    } else {
      await completeEnrichmentQuotaOperation({
        ...identity,
        status: 'completed',
        responseStatus: 200,
        responsePayload,
      });
    }
    return NextResponse.json(responsePayload, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (!providerBoundaryCrossed) {
      await releaseEnrichmentQuotaOperation(identity).catch(() => false);
    }
    if (error instanceof ApolloOrganizationEnrichmentError && !error.providerOutcomeUnknown) {
      const responsePayload = { error: error.code, operationId, operationStatus: 'failed' };
      await completeEnrichmentQuotaOperation({
        ...identity,
        status: 'failed',
        responseStatus: Math.max(400, Math.min(599, error.status)),
        responsePayload,
      });
      return NextResponse.json(responsePayload, { status: Math.max(400, Math.min(599, error.status)) });
    }
    return NextResponse.json({
      error: 'APOLLO_ORGANIZATION_OUTCOME_UNKNOWN',
      operationId,
      operationStatus: 'submitted',
      providerState: 'unknown',
    }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
