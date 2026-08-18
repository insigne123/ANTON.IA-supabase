import {
  MessagingDraftV1Schema,
  MessagingSendMetadataV1Schema,
  assertMessagingSendMetadataMatchesDraft,
  type MessagingDraftV1,
  type MessagingSendMetadataV1,
} from '@/lib/messaging-contracts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type OutboundDispatchStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'deferred' | 'unknown';

export type OutboundDispatch = {
  id: string;
  organizationId: string;
  userId: string;
  draftId: string;
  versionId: string;
  idempotencyKey: string;
  contentHash: string;
  channel: MessagingDraftV1['channel'];
  provider: string;
  status: OutboundDispatchStatus;
  metadata: MessagingSendMetadataV1;
  providerMessageId: string | null;
  providerResponse: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attemptCount?: number;
  reconciliationAttemptCount?: number;
  lastReconciliationAt?: string | null;
  reconciliationClaimedAt?: string | null;
  reconciledAt?: string | null;
  reconciliationDetails?: Record<string, unknown> | null;
};

export type OutboundPendingClaim = {
  created: boolean;
  dispatch: OutboundDispatch;
};

export type OutboundSendingClaim = {
  claimed: boolean;
  dispatch: OutboundDispatch;
};

export interface OutboundDispatchRepository {
  createPending(metadata: MessagingSendMetadataV1): Promise<OutboundPendingClaim>;
  markSending(
    dispatchId: string,
    input: { startedAt: string; expectedAttemptCount: number },
  ): Promise<OutboundSendingClaim>;
  markSent(
    dispatchId: string,
    input: {
      providerMessageId: string;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ): Promise<OutboundDispatch>;
  markFailed(
    dispatchId: string,
    input: {
      errorCode?: string | null;
      errorMessage: string;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ): Promise<OutboundDispatch>;
  markDeferred(
    dispatchId: string,
    input: {
      errorCode?: string | null;
      errorMessage: string;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ): Promise<OutboundDispatch>;
  markUnknown(
    dispatchId: string,
    input: {
      errorCode?: string | null;
      errorMessage: string;
      providerMessageId?: string | null;
      providerResponse?: Record<string, unknown> | null;
      completedAt: string;
    },
  ): Promise<OutboundDispatch>;
  findById(dispatchId: string): Promise<OutboundDispatch | null>;
  findByIdempotencyKey(organizationId: string, idempotencyKey: string): Promise<OutboundDispatch | null>;
  releaseQuotaReservation(dispatchId: string): Promise<void>;
}

export type OutboundProviderAccepted = {
  outcome: 'accepted';
  providerMessageId: string;
  response?: Record<string, unknown> | null;
};

export type OutboundProviderRejected = {
  outcome: 'rejected';
  code?: string | null;
  message: string;
  response?: Record<string, unknown> | null;
};

export type OutboundProviderDeferred = {
  outcome: 'deferred';
  code?: string | null;
  message: string;
  response?: Record<string, unknown> | null;
  retryAt?: string | null;
  retryAfterMs?: number | null;
};

export interface OutboundMessageProvider {
  send(input: {
    draft: MessagingDraftV1;
    metadata: MessagingSendMetadataV1;
    dispatchId: string;
  }): Promise<OutboundProviderAccepted | OutboundProviderRejected | OutboundProviderDeferred>;
}

export class OutboundDispatchConflictError extends Error {
  readonly existing: OutboundDispatch;

  constructor(existing: OutboundDispatch) {
    super('Idempotency key is already bound to different outbound content.');
    this.name = 'OutboundDispatchConflictError';
    this.existing = existing;
  }
}

export class ConfirmedProviderRejectionError extends Error {
  readonly code: string | null;
  readonly response: Record<string, unknown> | null;

  constructor(
    message: string,
    input: { code?: string | null; response?: Record<string, unknown> | null } = {},
  ) {
    super(message);
    this.name = 'ConfirmedProviderRejectionError';
    this.code = input.code ?? null;
    this.response = input.response ?? null;
  }
}

export class OutboundPreProviderDeferredError extends Error {
  readonly code: string;
  readonly retryAt: string | null;
  readonly retryAfterMs: number | null;
  readonly details: Record<string, unknown> | null;
  readonly cause: unknown;

  constructor(
    message: string,
    input: {
      code?: string;
      retryAt?: string | null;
      retryAfterMs?: number | null;
      details?: Record<string, unknown> | null;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'OutboundPreProviderDeferredError';
    this.code = String(input.code || '').trim() || 'pre_provider_deferred';
    this.retryAt = String(input.retryAt || '').trim() || null;
    this.retryAfterMs = Number.isFinite(input.retryAfterMs)
      ? Math.max(0, Math.trunc(Number(input.retryAfterMs)))
      : 30_000;
    this.details = input.details ?? null;
    this.cause = input.cause;
  }
}

export type OutboundDispatchRetryMetadata = {
  retryable: true;
  phase: 'pre_provider' | 'provider_deferred';
  code: string | null;
  retryAt: string | null;
  retryAfterMs: number | null;
};

export type OutboundDispatchResult = {
  status: OutboundDispatchStatus;
  dispatch: OutboundDispatch;
  replayed: boolean;
  retry?: OutboundDispatchRetryMetadata;
};

export type OutboundDispatchReconciliationEvidence =
  | {
      outcome: 'sent';
      providerMessageId: string;
      providerResponse?: Record<string, unknown> | null;
      details?: Record<string, unknown> | null;
    }
  | {
      outcome: 'failed';
      code?: string | null;
      message: string;
      providerResponse?: Record<string, unknown> | null;
      details?: Record<string, unknown> | null;
    }
  | { outcome: 'unresolved'; details?: Record<string, unknown> | null };

export interface OutboundDispatchReconciler {
  reconcile(dispatch: OutboundDispatch): Promise<OutboundDispatchReconciliationEvidence>;
}

export type OutboundReconciliationResult = {
  dispatch: OutboundDispatch;
  reconciled: boolean;
};

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

function mapDispatchRow(row: any): OutboundDispatch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    draftId: row.draft_id,
    versionId: row.version_id,
    idempotencyKey: row.idempotency_key,
    contentHash: row.content_hash,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    metadata: MessagingSendMetadataV1Schema.parse(row.metadata),
    providerMessageId: row.provider_message_id ?? null,
    providerResponse: row.provider_response ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    attemptCount: Number(row.attempt_count || 0),
    reconciliationAttemptCount: Number(row.reconciliation_attempt_count || 0),
    lastReconciliationAt: row.last_reconciliation_at ?? null,
    reconciliationClaimedAt: row.reconciliation_claimed_at ?? null,
    reconciledAt: row.reconciled_at ?? null,
    reconciliationDetails: row.reconciliation_details ?? null,
  };
}

function isUniqueViolation(error: any) {
  return error?.code === '23505';
}

export function createSupabaseOutboundDispatchRepository(
  client: SupabaseClientLike = getSupabaseAdminClient(),
): OutboundDispatchRepository {
  async function findById(dispatchId: string) {
    const { data, error } = await client
      .from('outbound_dispatches')
      .select('*')
      .eq('id', dispatchId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapDispatchRow(data) : null;
  }

  async function updateState(
    dispatchId: string,
    fromStatuses: OutboundDispatchStatus[],
    patch: Record<string, unknown>,
  ) {
    const { data, error } = await client
      .from('outbound_dispatches')
      .update(patch)
      .eq('id', dispatchId)
      .in('status', fromStatuses)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const current = await findById(dispatchId);
      if (current) return current;
      throw new Error(`Outbound dispatch ${dispatchId} no longer exists.`);
    }
    return mapDispatchRow(data);
  }

  return {
    async createPending(metadata) {
      const { data, error } = await client
        .from('outbound_dispatches')
        .insert({
          organization_id: metadata.organizationId,
          user_id: metadata.userId,
          draft_id: metadata.draftId,
          version_id: metadata.versionId,
          idempotency_key: metadata.idempotencyKey,
          content_hash: metadata.contentHash,
          channel: metadata.channel,
          provider: metadata.provider,
          status: 'pending',
          metadata,
          requested_at: metadata.requestedAt,
        })
        .select('*')
        .single();

      if (!error) return { created: true, dispatch: mapDispatchRow(data) };
      const { data: existing, error: existingError } = await client
        .from('outbound_dispatches')
        .select('*')
        .eq('organization_id', metadata.organizationId)
        .eq('idempotency_key', metadata.idempotencyKey)
        .maybeSingle();
      if (existingError) throw error;
      if (!existing) {
        if (!isUniqueViolation(error)) throw error;
        throw new Error('Idempotent dispatch exists but could not be read.');
      }
      return { created: false, dispatch: mapDispatchRow(existing) };
    },

    async markSending(dispatchId, input) {
      const { data, error } = await client
        .from('outbound_dispatches')
        .update({
          status: 'sending',
          started_at: input.startedAt,
          completed_at: null,
          provider_message_id: null,
          provider_response: null,
          error_code: null,
          error_message: null,
          updated_at: input.startedAt,
          attempt_count: input.expectedAttemptCount + 1,
        })
        .eq('id', dispatchId)
        .in('status', ['pending', 'deferred'])
        .eq('attempt_count', input.expectedAttemptCount)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (data) return { claimed: true, dispatch: mapDispatchRow(data) };
      const current = await findById(dispatchId);
      if (current) return { claimed: false, dispatch: current };
      throw new Error(`Outbound dispatch ${dispatchId} no longer exists.`);
    },

    markSent(dispatchId, input) {
      return updateState(dispatchId, ['sending'], {
        status: 'sent',
        provider_message_id: input.providerMessageId,
        provider_response: input.providerResponse ?? null,
        error_code: null,
        error_message: null,
        completed_at: input.completedAt,
        updated_at: input.completedAt,
      });
    },

    markFailed(dispatchId, input) {
      return updateState(dispatchId, ['sending'], {
        status: 'failed',
        provider_response: input.providerResponse ?? null,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage,
        completed_at: input.completedAt,
        updated_at: input.completedAt,
      });
    },

    markDeferred(dispatchId, input) {
      return updateState(dispatchId, ['sending'], {
        status: 'deferred',
        provider_message_id: null,
        provider_response: input.providerResponse ?? null,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage,
        completed_at: input.completedAt,
        updated_at: input.completedAt,
      });
    },

    markUnknown(dispatchId, input) {
      return updateState(dispatchId, ['pending', 'sending', 'deferred', 'unknown'], {
        status: 'unknown',
        provider_message_id: input.providerMessageId ?? null,
        provider_response: input.providerResponse ?? null,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage,
        completed_at: input.completedAt,
        updated_at: input.completedAt,
      });
    },

    findById,
    async findByIdempotencyKey(organizationId, idempotencyKey) {
      const { data, error } = await client
        .from('outbound_dispatches')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (error) throw error;
      return data ? mapDispatchRow(data) : null;
    },
    async releaseQuotaReservation(dispatchId) {
      const { error } = await client.rpc('release_outbound_contact_quota_v1', { p_dispatch_id: dispatchId });
      if (error) throw error;
    },
  };
}

export type OutboundDispatchDependencies = {
  repository?: OutboundDispatchRepository;
  now?: () => string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createRetryMetadata(input: {
  phase: OutboundDispatchRetryMetadata['phase'];
  code?: string | null;
  retryAt?: string | null;
  retryAfterMs?: number | null;
  at: string;
}): OutboundDispatchRetryMetadata {
  const retryAfterMs = Number.isFinite(input.retryAfterMs)
    ? Math.max(0, Math.trunc(Number(input.retryAfterMs)))
    : null;
  let retryAt = String(input.retryAt || '').trim() || null;
  if (!retryAt && retryAfterMs !== null) {
    const atMs = Date.parse(input.at);
    if (Number.isFinite(atMs)) retryAt = new Date(atMs + retryAfterMs).toISOString();
  }
  return {
    retryable: true,
    phase: input.phase,
    code: input.code ?? null,
    retryAt,
    retryAfterMs,
  };
}

function withRetryMetadata(
  response: Record<string, unknown> | null | undefined,
  retry: OutboundDispatchRetryMetadata,
) {
  return { ...(response ?? {}), retry };
}

function retryMetadataFromDispatch(dispatch: OutboundDispatch) {
  if (dispatch.status !== 'deferred') return undefined;
  const retry = dispatch.providerResponse?.retry as Partial<OutboundDispatchRetryMetadata> | undefined;
  if (retry?.retryable !== true || !['pre_provider', 'provider_deferred'].includes(String(retry.phase))) {
    return undefined;
  }
  return {
    retryable: true,
    phase: retry.phase as OutboundDispatchRetryMetadata['phase'],
    code: typeof retry.code === 'string' ? retry.code : null,
    retryAt: typeof retry.retryAt === 'string' ? retry.retryAt : null,
    retryAfterMs: Number.isFinite(retry.retryAfterMs) ? Math.max(0, Number(retry.retryAfterMs)) : null,
  } satisfies OutboundDispatchRetryMetadata;
}

function unknownView(dispatch: OutboundDispatch, input: {
  message: string;
  code?: string | null;
  providerMessageId?: string | null;
  providerResponse?: Record<string, unknown> | null;
  at: string;
}): OutboundDispatch {
  return {
    ...dispatch,
    status: 'unknown',
    errorCode: input.code ?? null,
    errorMessage: input.message,
    providerMessageId: input.providerMessageId ?? dispatch.providerMessageId,
    providerResponse: input.providerResponse ?? dispatch.providerResponse,
    completedAt: input.at,
    updatedAt: input.at,
  };
}

function unconfirmedPendingView(metadata: MessagingSendMetadataV1, at: string): OutboundDispatch {
  return {
    id: `unconfirmed:${metadata.idempotencyKey}`,
    organizationId: metadata.organizationId,
    userId: metadata.userId,
    draftId: metadata.draftId,
    versionId: metadata.versionId,
    idempotencyKey: metadata.idempotencyKey,
    contentHash: metadata.contentHash,
    channel: metadata.channel,
    provider: metadata.provider,
    status: 'unknown',
    metadata,
    providerMessageId: null,
    providerResponse: null,
    errorCode: 'persistence_ambiguity',
    errorMessage: 'Could not confirm whether the pending outbound dispatch was persisted.',
    createdAt: metadata.requestedAt,
    updatedAt: at,
    startedAt: null,
    completedAt: at,
  };
}

async function recordUnknown(
  repository: OutboundDispatchRepository,
  dispatch: OutboundDispatch,
  input: {
    message: string;
    code?: string | null;
    providerMessageId?: string | null;
    providerResponse?: Record<string, unknown> | null;
    at: string;
  },
): Promise<OutboundDispatch> {
  try {
    const recorded = await repository.markUnknown(dispatch.id, {
      errorCode: input.code,
      errorMessage: input.message,
      providerMessageId: input.providerMessageId,
      providerResponse: input.providerResponse,
      completedAt: input.at,
    });
    return recorded.status === 'sent' || recorded.status === 'failed' || recorded.status === 'deferred' ? recorded : recorded.status === 'unknown'
      ? recorded
      : unknownView(recorded, input);
  } catch (claimError) {
    try {
      const current = await repository.findById(dispatch.id);
      if (current?.status === 'sent' || current?.status === 'failed' || current?.status === 'deferred') return current;
      if (current?.status === 'unknown') return current;
      return unknownView(current ?? dispatch, input);
    } catch {
      return unknownView(dispatch, input);
    }
  }
}

function replay(dispatch: OutboundDispatch): OutboundDispatchResult {
  const retry = retryMetadataFromDispatch(dispatch);
  return {
    status: dispatch.status,
    dispatch,
    replayed: true,
    ...(retry ? { retry } : {}),
  };
}

async function releaseQuota(repository: OutboundDispatchRepository, dispatchId: string) {
  try {
    await repository.releaseQuotaReservation(dispatchId);
  } catch (error) {
    console.error('[outbound-dispatch] failed to release quota reservation', { dispatchId, error });
  }
}

export async function reconcileUnknownOutboundDispatch(
  dispatchInput: OutboundDispatch,
  reconciler: OutboundDispatchReconciler,
  dependencies?: { client?: SupabaseClientLike; now?: () => string },
): Promise<OutboundReconciliationResult> {
  const dispatch = dispatchInput;
  if (dispatch.status !== 'unknown') return { dispatch, reconciled: false };

  const now = dependencies?.now ?? (() => new Date().toISOString());
  const client = dependencies?.client ?? getSupabaseAdminClient();
  const attemptedAt = now();
  const evidence = dispatch.providerMessageId
    ? {
        outcome: 'sent' as const,
        providerMessageId: dispatch.providerMessageId,
        providerResponse: dispatch.providerResponse,
        details: { source: 'persisted_provider_message_id' },
      }
    : await reconciler.reconcile(dispatch);

  const expectedAttemptCount = dispatch.reconciliationAttemptCount || 0;
  const patch: Record<string, unknown> = {
    reconciliation_attempt_count: expectedAttemptCount + 1,
    last_reconciliation_at: attemptedAt,
    reconciliation_claimed_at: null,
    reconciliation_details: evidence.details ?? null,
    updated_at: attemptedAt,
  };
  if (evidence.outcome === 'sent') {
    const providerMessageId = String(evidence.providerMessageId || '').trim();
    if (!providerMessageId) {
      patch.reconciliation_details = {
        ...(evidence.details ?? {}),
        reason: 'provider_message_id_missing',
      };
    } else {
      Object.assign(patch, {
        status: 'sent',
        started_at: dispatch.startedAt || dispatch.createdAt,
        provider_message_id: providerMessageId,
        provider_response: evidence.providerResponse ?? dispatch.providerResponse,
        error_code: null,
        error_message: null,
        reconciled_at: attemptedAt,
        completed_at: dispatch.completedAt || attemptedAt,
      });
      if (!dispatch.startedAt) patch.attempt_count = 1;
    }
  } else if (evidence.outcome === 'failed') {
    Object.assign(patch, {
      status: 'failed',
      started_at: dispatch.startedAt || dispatch.createdAt,
      provider_response: evidence.providerResponse ?? dispatch.providerResponse,
      error_code: evidence.code ?? 'reconciled_provider_failure',
      error_message: evidence.message,
      reconciled_at: attemptedAt,
      completed_at: dispatch.completedAt || attemptedAt,
    });
    if (!dispatch.startedAt) patch.attempt_count = 1;
  }

  const { data, error } = await client
    .from('outbound_dispatches')
    .update(patch)
    .eq('id', dispatch.id)
    .eq('status', 'unknown')
    .eq('reconciliation_attempt_count', expectedAttemptCount)
    .eq('reconciliation_claimed_at', dispatch.reconciliationClaimedAt ?? attemptedAt)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { dispatch, reconciled: false };
  const updated = mapDispatchRow(data);
  if (updated.status === 'failed') {
    await releaseQuota(createSupabaseOutboundDispatchRepository(client), updated.id);
  }
  return { dispatch: updated, reconciled: updated.status === 'sent' || updated.status === 'failed' };
}

export async function dispatchOutboundMessage(
  input: {
    draft: MessagingDraftV1;
    metadata: MessagingSendMetadataV1;
    provider: OutboundMessageProvider;
  },
  dependencies?: OutboundDispatchDependencies,
): Promise<OutboundDispatchResult> {
  const draft = MessagingDraftV1Schema.parse(input.draft);
  const metadata = assertMessagingSendMetadataMatchesDraft(draft, input.metadata);
  const repository = dependencies?.repository ?? createSupabaseOutboundDispatchRepository();
  const now = dependencies?.now ?? (() => new Date().toISOString());

  let claim: OutboundPendingClaim;
  try {
    claim = await repository.createPending(metadata);
  } catch (claimError) {
    let recovered: OutboundDispatch | null = null;
    try {
      const existing = await repository.findByIdempotencyKey(metadata.organizationId, metadata.idempotencyKey);
      if (existing) {
        if (
          existing.contentHash !== metadata.contentHash
          || existing.versionId !== metadata.versionId
          || existing.channel !== metadata.channel
          || existing.provider !== metadata.provider
        ) {
          throw new OutboundDispatchConflictError(existing);
        }
        recovered = existing;
      }
    } catch (error) {
      if (error instanceof OutboundDispatchConflictError) throw error;
    }
    if (recovered) {
      claim = { created: false, dispatch: recovered };
    } else {
      const message = errorMessage(claimError);
      return {
        status: 'unknown',
        dispatch: {
          ...unconfirmedPendingView(metadata, now()),
          errorMessage: `Could not confirm whether the pending outbound dispatch was persisted: ${message}`,
        },
        replayed: false,
      };
    }
  }
  if (!claim.created) {
    if (
      claim.dispatch.contentHash !== metadata.contentHash
      || claim.dispatch.versionId !== metadata.versionId
      || claim.dispatch.channel !== metadata.channel
      || claim.dispatch.provider !== metadata.provider
    ) {
      throw new OutboundDispatchConflictError(claim.dispatch);
    }
    if (claim.dispatch.status === 'failed') {
      await releaseQuota(repository, claim.dispatch.id);
    }
    if (claim.dispatch.status !== 'deferred') return replay(claim.dispatch);
  }

  let dispatch = claim.dispatch;
  try {
    const sendingClaim = await repository.markSending(dispatch.id, {
      startedAt: now(),
      expectedAttemptCount: dispatch.attemptCount ?? (dispatch.status === 'pending' ? 0 : 1),
    });
    dispatch = sendingClaim.dispatch;
    if (!sendingClaim.claimed || dispatch.status !== 'sending') return replay(dispatch);
  } catch (error) {
    const at = now();
    const unknown = await recordUnknown(repository, dispatch, {
      code: 'persistence_error',
      message: `Could not durably mark outbound dispatch as sending: ${errorMessage(error)}`,
      at,
    });
    return { status: unknown.status, dispatch: unknown, replayed: false };
  }

  let providerResult: OutboundProviderAccepted | OutboundProviderRejected | OutboundProviderDeferred;
  try {
    providerResult = await input.provider.send({ draft, metadata, dispatchId: dispatch.id });
  } catch (error) {
    const at = now();
    if (error instanceof OutboundPreProviderDeferredError) {
      const retry = createRetryMetadata({
        phase: 'pre_provider',
        code: error.code,
        retryAt: error.retryAt,
        retryAfterMs: error.retryAfterMs,
        at,
      });
      try {
        const deferred = await repository.markDeferred(dispatch.id, {
          errorCode: error.code,
          errorMessage: error.message,
          providerResponse: withRetryMetadata(error.details, retry),
          completedAt: at,
        });
        if (deferred.status === 'deferred') await releaseQuota(repository, dispatch.id);
        return {
          status: deferred.status,
          dispatch: deferred,
          replayed: false,
          ...(deferred.status === 'deferred' ? { retry: retryMetadataFromDispatch(deferred) ?? retry } : {}),
        };
      } catch (persistenceError) {
        const unknown = await recordUnknown(repository, dispatch, {
          code: 'persistence_error',
          message: `The provider was not invoked, but the deferral could not be persisted: ${errorMessage(persistenceError)}`,
          at,
        });
        return { status: unknown.status, dispatch: unknown, replayed: false };
      }
    }

    if (error instanceof ConfirmedProviderRejectionError) {
      try {
        const failed = await repository.markFailed(dispatch.id, {
          errorCode: error.code,
          errorMessage: error.message,
          providerResponse: error.response,
          completedAt: at,
        });
        await releaseQuota(repository, dispatch.id);
        return { status: failed.status, dispatch: failed, replayed: false };
      } catch (persistenceError) {
        const unknown = await recordUnknown(repository, dispatch, {
          code: 'persistence_error',
          message: `Provider rejected the message, but the failure could not be persisted: ${errorMessage(persistenceError)}`,
          at,
        });
        return { status: unknown.status, dispatch: unknown, replayed: false };
      }
    }

    const unknown = await recordUnknown(repository, dispatch, {
      code: 'provider_outcome_unknown',
      message: `Provider outcome is unknown: ${errorMessage(error)}`,
      at,
    });
    return { status: unknown.status, dispatch: unknown, replayed: false };
  }

  const completedAt = now();
  if (providerResult.outcome === 'deferred') {
    const retry = createRetryMetadata({
      phase: 'provider_deferred',
      code: providerResult.code,
      retryAt: providerResult.retryAt,
      retryAfterMs: providerResult.retryAfterMs,
      at: completedAt,
    });
    try {
      const deferred = await repository.markDeferred(dispatch.id, {
        errorCode: providerResult.code,
        errorMessage: providerResult.message,
        providerResponse: withRetryMetadata(providerResult.response, retry),
        completedAt,
      });
      if (deferred.status === 'deferred') await releaseQuota(repository, dispatch.id);
      return {
        status: deferred.status,
        dispatch: deferred,
        replayed: false,
        ...(deferred.status === 'deferred' ? { retry: retryMetadataFromDispatch(deferred) ?? retry } : {}),
      };
    } catch (error) {
      const unknown = await recordUnknown(repository, dispatch, {
        code: 'persistence_error',
        message: `Provider deferred the message, but the deferral could not be persisted: ${errorMessage(error)}`,
        at: completedAt,
      });
      return { status: unknown.status, dispatch: unknown, replayed: false };
    }
  }

  if (providerResult.outcome === 'rejected') {
    try {
      const failed = await repository.markFailed(dispatch.id, {
        errorCode: providerResult.code,
        errorMessage: providerResult.message,
        providerResponse: providerResult.response,
        completedAt,
      });
      await releaseQuota(repository, dispatch.id);
      return { status: failed.status, dispatch: failed, replayed: false };
    } catch (error) {
      const unknown = await recordUnknown(repository, dispatch, {
        code: 'persistence_error',
        message: `Provider rejected the message, but the failure could not be persisted: ${errorMessage(error)}`,
        at: completedAt,
      });
      return { status: unknown.status, dispatch: unknown, replayed: false };
    }
  }

  if (typeof providerResult.providerMessageId !== 'string' || !providerResult.providerMessageId.trim()) {
    const unknown = await recordUnknown(repository, dispatch, {
      code: 'invalid_provider_response',
      message: 'Provider accepted the message without a usable message identifier.',
      providerResponse: providerResult.response,
      at: completedAt,
    });
    return { status: unknown.status, dispatch: unknown, replayed: false };
  }

  try {
    const sent = await repository.markSent(dispatch.id, {
      providerMessageId: providerResult.providerMessageId,
      providerResponse: providerResult.response,
      completedAt,
    });
    return { status: sent.status, dispatch: sent, replayed: false };
  } catch (error) {
    const unknown = await recordUnknown(repository, dispatch, {
      code: 'persistence_error',
      message: `Provider accepted the message, but confirmation could not be persisted: ${errorMessage(error)}`,
      providerMessageId: providerResult.providerMessageId,
      providerResponse: providerResult.response,
      at: completedAt,
    });
    return { status: unknown.status, dispatch: unknown, replayed: false };
  }
}
