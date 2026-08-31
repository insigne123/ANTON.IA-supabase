import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import {
  fetchFullEnrichBulkEnrichmentResult,
  type FullEnrichBulkEnrichmentResult,
} from '@/lib/server/fullenrich-enrichment';
import {
  FULLENRICH_CALLBACK_CUSTOM_KEY,
  processFullEnrichRetrievedResult,
  type FullEnrichRetrievedResultProcessingResult,
} from '@/lib/server/fullenrich-enrichment-callbacks';

type ServiceClient = any;

const DEFAULT_BATCH_LIMIT = 25;
const DEFAULT_STALE_AFTER_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_CLAIM_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_RECONCILIATION_ATTEMPTS = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReconciliationCandidate = {
  callbackId: string;
  providerEnrichmentId: string;
  claimedAt: string;
  reconciliationAttemptCount: number;
};

type ProcessResult = (
  input: { rawBody: Buffer; apiKey: string; expectedProviderEnrichmentId: string },
  client: ServiceClient,
) => Promise<FullEnrichRetrievedResultProcessingResult>;

export type FullEnrichReconciliationSummary = {
  claimed: number;
  batches: number;
  processed: number;
  duplicates: number;
  inProgress: number;
  notFound: number;
  errors: number;
  skipped?: 'api_key_not_configured';
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function candidate(value: unknown): ReconciliationCandidate | null {
  const input = record(value);
  const callbackId = text(input?.callback_id, 36);
  const providerEnrichmentId = text(input?.provider_enrichment_id, 200);
  const claimedAt = text(input?.reconciliation_claimed_at, 64);
  const rawAttemptCount = input?.reconciliation_attempt_count;
  const reconciliationAttemptCount = rawAttemptCount === undefined
    ? 1
    : typeof rawAttemptCount === 'number' && Number.isInteger(rawAttemptCount) && rawAttemptCount > 0
      ? rawAttemptCount
      : null;
  if (
    !callbackId
    || !UUID_RE.test(callbackId)
    || !providerEnrichmentId
    || !claimedAt
    || Number.isNaN(Date.parse(claimedAt))
    || reconciliationAttemptCount === null
  ) {
    return null;
  }
  return {
    callbackId: callbackId.toLowerCase(),
    providerEnrichmentId,
    claimedAt,
    reconciliationAttemptCount,
  };
}

function dateBefore(now: Date, durationMs: number) {
  return new Date(now.getTime() - durationMs).toISOString();
}

function newSummary(): FullEnrichReconciliationSummary {
  return {
    claimed: 0,
    batches: 0,
    processed: 0,
    duplicates: 0,
    inProgress: 0,
    notFound: 0,
    errors: 0,
  };
}

async function claimCandidates(
  client: ServiceClient,
  input: {
    limit: number;
    staleBefore: string;
    cooldownBefore: string;
    claimBefore: string;
  },
) {
  const { data, error } = await client.rpc('claim_fullenrich_enrichment_reconciliation_candidates_v2', {
    p_limit: input.limit,
    p_stale_before: input.staleBefore,
    p_cooldown_before: input.cooldownBefore,
    p_claim_before: input.claimBefore,
  });
  if (error) throw new Error('FULLENRICH_RECONCILIATION_CLAIM_FAILED');
  return Array.isArray(data)
    ? data.map(candidate).filter((item): item is ReconciliationCandidate => item !== null)
    : [];
}

async function releaseCandidates(
  client: ServiceClient,
  candidates: readonly ReconciliationCandidate[],
  errorCode: string | null,
) {
  const byClaim = new Map<string, ReconciliationCandidate[]>();
  for (const item of candidates) {
    const group = byClaim.get(item.claimedAt) || [];
    group.push(item);
    byClaim.set(item.claimedAt, group);
  }

  for (const [claimedAt, group] of byClaim) {
    const { error } = await client.rpc('release_fullenrich_enrichment_reconciliation_candidates_v2', {
      p_callback_ids: group.map((item) => item.callbackId),
      p_claimed_at: claimedAt,
      p_error_code: errorCode,
    });
    if (error) throw new Error('FULLENRICH_RECONCILIATION_RELEASE_FAILED');
  }
}

function resultsByProvider(candidates: readonly ReconciliationCandidate[]) {
  const groups = new Map<string, ReconciliationCandidate[]>();
  for (const item of candidates) {
    const group = groups.get(item.providerEnrichmentId) || [];
    group.push(item);
    groups.set(item.providerEnrichmentId, group);
  }
  return groups;
}

function terminalResultBody(
  providerEnrichmentId: string,
  providerStatus: 'CREDITS_INSUFFICIENT' | 'UNKNOWN',
  candidates: readonly ReconciliationCandidate[],
) {
  return Buffer.from(JSON.stringify({
    id: providerEnrichmentId,
    status: providerStatus,
    data: candidates.map((item) => ({
      custom: { [FULLENRICH_CALLBACK_CUSTOM_KEY]: item.callbackId },
    })),
  }));
}

function terminalProviderErrorCode(providerStatus: string) {
  switch (providerStatus) {
    case 'CREDITS_INSUFFICIENT':
      return 'FULLENRICH_RESULT_CREDITS_INSUFFICIENT';
    case 'RATE_LIMIT':
      return 'FULLENRICH_RESULT_RATE_LIMIT';
    case 'UNKNOWN':
      return 'FULLENRICH_RESULT_UNKNOWN';
    case 'CANCELED':
      return 'FULLENRICH_RESULT_CANCELED';
    default:
      return null;
  }
}

async function releaseSafely(
  client: ServiceClient,
  candidates: readonly ReconciliationCandidate[],
  errorCode: string | null,
  summary: FullEnrichReconciliationSummary,
) {
  try {
    await releaseCandidates(client, candidates, errorCode);
  } catch {
    // A stale claim is retried after its TTL; never leak provider or contact data in cron logs.
    summary.errors += 1;
  }
}

async function settleTerminalFailure(
  client: ServiceClient,
  candidates: readonly ReconciliationCandidate[],
  input: {
    apiKey: string;
    providerEnrichmentId: string;
    providerStatus: 'CREDITS_INSUFFICIENT' | 'UNKNOWN';
    errorCode: string;
    processResult: ProcessResult;
  },
  summary: FullEnrichReconciliationSummary,
) {
  const outcome = await input.processResult({
    rawBody: terminalResultBody(input.providerEnrichmentId, input.providerStatus, candidates),
    apiKey: input.apiKey,
    expectedProviderEnrichmentId: input.providerEnrichmentId,
  }, client);
  if (outcome.kind !== 'processed' || outcome.ignored > 0) {
    throw new Error('FULLENRICH_TERMINAL_FAILURE_UNAPPLIED');
  }

  const returnedCallbacks = new Set(outcome.callbackIds);
  if (candidates.some((item) => !returnedCallbacks.has(item.callbackId))) {
    throw new Error('FULLENRICH_TERMINAL_FAILURE_UNAPPLIED');
  }

  summary.processed += outcome.processed;
  summary.duplicates += outcome.duplicates;
  await releaseSafely(client, candidates, input.errorCode, summary);
}

function exhaustedCandidates(candidates: readonly ReconciliationCandidate[], maxAttempts: number) {
  return candidates.filter((candidate) => candidate.reconciliationAttemptCount >= maxAttempts);
}

export async function reconcileFullEnrichEnrichmentCallbacks(
  input: {
    apiKey?: string;
    client?: ServiceClient;
    now?: Date;
    limit?: number;
    staleAfterMs?: number;
    cooldownMs?: number;
    claimTtlMs?: number;
    maxAttempts?: number;
    fetchResult?: (input: { apiKey: string; enrichmentId: string }) => Promise<FullEnrichBulkEnrichmentResult>;
    processResult?: ProcessResult;
  } = {},
): Promise<FullEnrichReconciliationSummary> {
  const apiKey = String(input.apiKey ?? process.env.FULLENRICH_API_KEY ?? '').trim();
  const summary = newSummary();
  if (!apiKey) return { ...summary, skipped: 'api_key_not_configured' };

  const client = input.client || getSupabaseAdminClient();
  const now = input.now || new Date();
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? DEFAULT_BATCH_LIMIT)));
  const staleAfterMs = Math.max(60_000, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const cooldownMs = Math.max(60_000, input.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  const claimTtlMs = Math.max(60_000, input.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS);
  const configuredMaxAttempts = Number(input.maxAttempts);
  const maxAttempts = Number.isFinite(configuredMaxAttempts)
    ? Math.max(1, Math.min(20, Math.floor(configuredMaxAttempts)))
    : DEFAULT_MAX_RECONCILIATION_ATTEMPTS;
  const claimed = await claimCandidates(client, {
    limit,
    staleBefore: dateBefore(now, staleAfterMs),
    cooldownBefore: dateBefore(now, cooldownMs),
    claimBefore: dateBefore(now, claimTtlMs),
  });
  summary.claimed = claimed.length;

  const retrieve = input.fetchResult || ((request) => fetchFullEnrichBulkEnrichmentResult(request));
  const processResult = input.processResult || ((request, serviceClient) => processFullEnrichRetrievedResult(request, serviceClient));

  for (const [providerEnrichmentId, batch] of resultsByProvider(claimed)) {
    summary.batches += 1;
    try {
      const result = await retrieve({ apiKey, enrichmentId: providerEnrichmentId });
      if (result.kind === 'terminal_failure') {
        await settleTerminalFailure(client, batch, {
          apiKey,
          providerEnrichmentId,
          providerStatus: result.providerStatus,
          errorCode: terminalProviderErrorCode(result.providerStatus) || 'FULLENRICH_RESULT_UNKNOWN',
          processResult,
        }, summary);
        continue;
      }
      if (result.kind === 'in_progress') {
        summary.inProgress += batch.length;
        await releaseSafely(client, batch, null, summary);
        continue;
      }
      if (result.kind === 'not_found') {
        summary.notFound += batch.length;
        const exhausted = exhaustedCandidates(batch, maxAttempts);
        if (exhausted.length > 0) {
          await settleTerminalFailure(client, exhausted, {
            apiKey,
            providerEnrichmentId,
            providerStatus: 'UNKNOWN',
            errorCode: 'FULLENRICH_RESULT_NOT_FOUND',
            processResult,
          }, summary);
        }
        const retryable = batch.filter((item) => !exhausted.includes(item));
        if (retryable.length > 0) {
          await releaseSafely(client, retryable, 'FULLENRICH_RESULT_NOT_FOUND', summary);
        }
        continue;
      }
      if (result.kind === 'retryable_error') {
        summary.errors += batch.length;
        const exhausted = exhaustedCandidates(batch, maxAttempts);
        if (exhausted.length > 0) {
          await settleTerminalFailure(client, exhausted, {
            apiKey,
            providerEnrichmentId,
            providerStatus: 'UNKNOWN',
            errorCode: result.errorCode,
            processResult,
          }, summary);
        }
        const retryable = batch.filter((item) => !exhausted.includes(item));
        if (retryable.length > 0) {
          await releaseSafely(client, retryable, result.errorCode, summary);
        }
        continue;
      }

      const outcome = await processResult({
        rawBody: result.rawBody,
        apiKey,
        expectedProviderEnrichmentId: providerEnrichmentId,
      }, client);
      if (outcome.kind === 'in_progress') {
        summary.inProgress += batch.length;
        await releaseSafely(client, batch, null, summary);
        continue;
      }
      if (outcome.kind === 'invalid_payload') {
        summary.errors += batch.length;
        const exhausted = exhaustedCandidates(batch, maxAttempts);
        if (exhausted.length > 0) {
          await settleTerminalFailure(client, exhausted, {
            apiKey,
            providerEnrichmentId,
            providerStatus: 'UNKNOWN',
            errorCode: 'FULLENRICH_RESULT_INVALID_PAYLOAD',
            processResult,
          }, summary);
        }
        const retryable = batch.filter((item) => !exhausted.includes(item));
        if (retryable.length > 0) {
          await releaseSafely(client, retryable, 'FULLENRICH_RESULT_INVALID_PAYLOAD', summary);
        }
        continue;
      }

      summary.processed += outcome.processed;
      summary.duplicates += outcome.duplicates;
      const returnedCallbacks = new Set(outcome.callbackIds);
      // A terminal response must identify the exact opaque callback before it
      // can settle it. An omitted entry may be a provider payload mismatch.
      const hasUnappliedCallback = batch.some((item) => !returnedCallbacks.has(item.callbackId));
      await releaseSafely(
        client,
        batch,
        outcome.ignored > 0 || hasUnappliedCallback
          ? 'FULLENRICH_RESULT_UNAPPLIED'
          : terminalProviderErrorCode(outcome.providerStatus),
        summary,
      );
    } catch {
      summary.errors += batch.length;
      await releaseSafely(client, batch, 'FULLENRICH_RECONCILIATION_FAILED', summary);
    }
  }

  return summary;
}
