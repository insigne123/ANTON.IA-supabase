import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateInternalRequest,
  auditGatewayRequest,
  consumeEndpointRateLimit,
  getGatewayConfig,
  getRequestId,
  readBoundedJsonBody,
} from '../../../lib/gateway';
import { ApolloGatewayError, executeEnrichment, getApolloApiKey } from '../../../lib/apollo';
import { validateEnrichmentInput } from '../../../lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function response(body: Record<string, unknown>, status: number, requestId: string) {
  const result = NextResponse.json({ ...body, request_id: requestId }, { status });
  result.headers.set('cache-control', 'no-store');
  result.headers.set('x-content-type-options', 'nosniff');
  result.headers.set('x-request-id', requestId);
  return result;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = getRequestId(request.headers);
  const config = getGatewayConfig();
  const finish = (status: number, outcome: string, metrics?: Record<string, number | boolean | string | undefined>) => {
    auditGatewayRequest({
      route: 'enrich',
      requestId,
      status,
      outcome,
      durationMs: Date.now() - startedAt,
      metrics,
    });
  };

  const authentication = authenticateInternalRequest(request.headers);
  if (!authentication.ok) {
    finish(authentication.status, authentication.code);
    return response({ error: authentication.code }, authentication.status, requestId);
  }

  const rateLimit = consumeEndpointRateLimit('enrich', config);
  if (!rateLimit.allowed) {
    finish(429, 'RATE_LIMITED', { rateLimit: rateLimit.limit });
    const result = response({ error: 'RATE_LIMITED' }, 429, requestId);
    result.headers.set('retry-after', String(rateLimit.retryAfterSeconds));
    result.headers.set('x-rate-limit-limit', String(rateLimit.limit));
    return result;
  }

  const body = await readBoundedJsonBody(request, config.maxRequestBytes);
  if (!body.ok) {
    finish(body.status, body.code);
    return response({ error: body.code }, body.status, requestId);
  }

  const input = validateEnrichmentInput(body.value);
  if (!input.ok) {
    finish(400, 'INVALID_REQUEST');
    return response({ error: 'INVALID_REQUEST', details: input.issues }, 400, requestId);
  }

  const apiKey = getApolloApiKey();
  if (!apiKey) {
    finish(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');
    return response({ error: 'APOLLO_PROVIDER_NOT_CONFIGURED' }, 503, requestId);
  }

  try {
    const result = await executeEnrichment(input.value, apiKey, config);
    finish(200, result.success ? 'COMPLETED' : 'NOT_FOUND', {
      revealEmail: input.value.revealEmail,
      revealPhone: input.value.revealPhone,
      enrichmentLevel: input.value.enrichmentLevel,
      rateLimitRemaining: rateLimit.remaining,
    });
    return response(result, 200, requestId);
  } catch (error) {
    if (error instanceof ApolloGatewayError) {
      finish(error.status, error.code, {
        revealEmail: input.value.revealEmail,
        revealPhone: input.value.revealPhone,
      });
      return response({ error: error.code }, error.status, requestId);
    }

    console.error('[apollo-backend] enrich failed', { requestId, code: 'BACKEND_ERROR' });
    finish(500, 'BACKEND_ERROR');
    return response({ error: 'BACKEND_ERROR' }, 500, requestId);
  }
}
