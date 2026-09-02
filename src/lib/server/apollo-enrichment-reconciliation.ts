import { createHash } from 'node:crypto';

import { pollApolloWebhookResult } from '@/lib/server/apollo-enrichment';
import {
  applyApolloEnrichmentCandidate,
  settleApolloEnrichmentCallback,
  type ApolloWebhookCandidate,
} from '@/lib/server/apollo-enrichment-callbacks';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type ServiceClient = any;

type Candidate = {
  callbackId: string;
  tokenHash: string;
  providerRequestId?: string;
  apolloPersonId?: string;
  expiresAt: string;
  claimedAt: string;
  attemptCount: number;
};

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).trim();
  return normalized.length <= maxLength ? normalized : '';
}

function parseCandidate(value: any): Candidate | null {
  const callbackId = text(value?.callback_id, 36);
  const tokenHash = text(value?.token_hash, 64);
  const expiresAt = text(value?.expires_at, 64);
  const claimedAt = text(value?.reconciliation_claimed_at, 64);
  const attemptCount = Number(value?.reconciliation_attempt_count);
  if (!callbackId || !/^[0-9a-f]{64}$/.test(tokenHash) || !expiresAt || !claimedAt || !Number.isInteger(attemptCount)) {
    return null;
  }
  return {
    callbackId,
    tokenHash,
    providerRequestId: text(value?.provider_request_id, 255) || undefined,
    apolloPersonId: text(value?.apollo_person_id, 255) || undefined,
    expiresAt,
    claimedAt,
    attemptCount,
  };
}

async function claimCandidates(limit: number, client: ServiceClient) {
  const now = Date.now();
  const { data, error } = await client.rpc('claim_apollo_enrichment_reconciliation_candidates_v1', {
    p_limit: Math.max(1, Math.min(100, Math.trunc(limit))),
    p_stale_before: new Date(now - 2 * 60 * 1_000).toISOString(),
    p_cooldown_before: new Date(now - 5 * 60 * 1_000).toISOString(),
    p_claim_before: new Date(now - 10 * 60 * 1_000).toISOString(),
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.map(parseCandidate).filter((item): item is Candidate => item !== null);
}

async function releaseCandidate(
  candidate: Candidate,
  errorCode: string,
  retryAfterSeconds: number | undefined,
  client: ServiceClient,
) {
  const retryAfter = Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Math.min(86_400, Math.trunc(retryAfterSeconds!)))
    : 300;
  const { error } = await client.rpc('release_apollo_enrichment_reconciliation_candidates_v1', {
    p_callback_ids: [candidate.callbackId],
    p_claimed_at: candidate.claimedAt,
    p_error_code: text(errorCode, 100) || 'reconciliation_deferred',
    p_retry_after_seconds: retryAfter,
  });
  if (error) throw error;
}

function normalizedStatus(value: unknown) {
  return text(value, 64).toLowerCase().replace(/[\s-]+/g, '_');
}

const PENDING_STATUSES = new Set(['pending', 'processing', 'result_pending', 'in_progress']);
const READY_STATUSES = new Set(['completed', 'complete', 'ready', 'success', 'succeeded']);
const UNKNOWN_STATUSES = new Set(['request_id_unknown', 'request_unknown', 'not_found']);
const EXPIRED_STATUSES = new Set(['request_id_expired', 'expired']);
const INVALID_STATUSES = new Set(['invalid_request_id', 'invalid']);

export async function reconcileApolloEnrichmentCallbacks(input: {
  limit?: number;
  now?: Date;
  client?: ServiceClient;
  environment?: Record<string, string | undefined>;
} = {}) {
  const client = input.client || getSupabaseAdminClient();
  const now = input.now || new Date();
  const candidates = await claimCandidates(input.limit || 25, client);
  const summary = {
    claimed: candidates.length,
    processed: 0,
    pending: 0,
    expired: 0,
    failed: 0,
    released: 0,
  };

  for (const candidate of candidates) {
    try {
      if (new Date(candidate.expiresAt).getTime() <= now.getTime()) {
        await settleApolloEnrichmentCallback({
          callbackId: candidate.callbackId,
          terminalState: 'expired',
          errorCode: 'apollo_callback_expired',
        }, client);
        summary.expired += 1;
        continue;
      }
      if (!candidate.providerRequestId) {
        await releaseCandidate(candidate, 'provider_request_id_pending', 300, client);
        summary.released += 1;
        continue;
      }

      const result = await pollApolloWebhookResult({
        providerRequestId: candidate.providerRequestId,
        environment: input.environment,
      });
      const status = normalizedStatus(result.status);
      if (PENDING_STATUSES.has(status)) {
        await releaseCandidate(candidate, 'apollo_result_pending', result.retryAfterSeconds, client);
        summary.pending += 1;
        continue;
      }
      if (UNKNOWN_STATUSES.has(status) || INVALID_STATUSES.has(status)) {
        await settleApolloEnrichmentCallback({
          callbackId: candidate.callbackId,
          terminalState: 'failed',
          errorCode: UNKNOWN_STATUSES.has(status) ? 'apollo_request_id_unknown' : 'apollo_invalid_request_id',
        }, client);
        summary.failed += 1;
        continue;
      }
      if (EXPIRED_STATUSES.has(status)) {
        await settleApolloEnrichmentCallback({
          callbackId: candidate.callbackId,
          terminalState: 'expired',
          errorCode: 'apollo_request_id_expired',
        }, client);
        summary.expired += 1;
        continue;
      }
      if (!READY_STATUSES.has(status)) {
        await releaseCandidate(candidate, 'apollo_unrecognized_poll_status', 300, client);
        summary.released += 1;
        continue;
      }

      const polledCandidate = result.candidate as ApolloWebhookCandidate | null;
      if (!polledCandidate || Object.keys(polledCandidate).length === 0) {
        await settleApolloEnrichmentCallback({
          callbackId: candidate.callbackId,
          terminalState: 'no_data',
          errorCode: 'apollo_poll_no_data',
        }, client);
      } else {
        const enrichedCandidate = {
          ...polledCandidate,
          apollo_person_id: polledCandidate.apollo_person_id || candidate.apolloPersonId,
        };
        await applyApolloEnrichmentCandidate({
          tokenHash: candidate.tokenHash,
          providerRequestId: result.providerRequestId,
          providerStatus: 'SUCCEEDED',
          payloadHash: createHash('sha256').update(JSON.stringify(enrichedCandidate)).digest('hex'),
          candidate: enrichedCandidate,
        }, client);
      }
      summary.processed += 1;
    } catch {
      await releaseCandidate(candidate, 'apollo_reconciliation_error', 300, client).catch(() => undefined);
      summary.released += 1;
    }
  }

  return summary;
}
