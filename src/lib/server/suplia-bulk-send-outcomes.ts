import {
  getSupliaRetryAfterMs,
  getSupliaRuntimeErrorCode,
  isSupliaTransientError,
  SupliaRuntimeError,
} from '@/lib/suplia/runtime';

export type SupliaBulkRecipientOutcome = {
  status: 'sent' | 'rejected' | 'deferred' | 'transient' | 'unknown';
  to: string;
  index: number;
  contactedId?: string;
  provider?: string;
  error?: string;
  code?: string | null;
  dispatchId?: string | null;
  retryAt?: string | null;
  retryExpected?: boolean;
  requiresReconciliation?: boolean;
};

export class SupliaRecipientDeliveryError extends Error {
  readonly outcome: 'rejected' | 'unknown';
  readonly metadata: Record<string, unknown>;

  constructor(outcome: 'rejected' | 'unknown', message: string, metadata: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SupliaRecipientDeliveryError';
    this.outcome = outcome;
    this.metadata = metadata;
  }
}

export class SupliaDeliveryReconciliationError extends Error {
  readonly code = 'delivery_reconciliation_required';
  readonly metadata: Record<string, unknown>;

  constructor(message: string, metadata: Record<string, unknown>) {
    super(message);
    this.name = 'SupliaDeliveryReconciliationError';
    this.metadata = metadata;
  }
}

function asMetadata(error: unknown) {
  const metadata = (error as any)?.metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

function asOptionalText(value: unknown) {
  const text = String(value || '').trim();
  return text || null;
}

function retryAtFor(error: unknown, metadata: Record<string, unknown>, nowMs: number) {
  const supplied = asOptionalText(metadata.retryAt);
  if (supplied && Number.isFinite(Date.parse(supplied))) return new Date(supplied).toISOString();
  return new Date(nowMs + getSupliaRetryAfterMs(error)).toISOString();
}

export function classifySupliaBulkRecipientError(
  error: unknown,
  recipient: { to: string; index: number },
  nowMs = Date.now(),
): SupliaBulkRecipientOutcome {
  const message = error instanceof Error ? error.message : String(error || 'send_failed');
  const metadata = asMetadata(error);
  const runtimeCode = getSupliaRuntimeErrorCode(error);
  const common = {
    to: recipient.to,
    index: recipient.index,
    error: message,
    code: asOptionalText(metadata.code) || runtimeCode,
    dispatchId: asOptionalText(metadata.dispatchId),
  };

  if (error instanceof SupliaRecipientDeliveryError && error.outcome === 'unknown') {
    return { ...common, status: 'unknown', retryExpected: false, requiresReconciliation: true };
  }
  if (error instanceof SupliaRecipientDeliveryError && error.outcome === 'rejected') {
    return { ...common, status: 'rejected', retryExpected: false };
  }
  if (runtimeCode === 'deferred') {
    return { ...common, status: 'deferred', retryAt: retryAtFor(error, metadata, nowMs), retryExpected: true };
  }
  if (runtimeCode === 'transient' || runtimeCode === 'timeout' || runtimeCode === 'rate_limited' || isSupliaTransientError(error)) {
    return { ...common, status: 'transient', retryAt: retryAtFor(error, metadata, nowMs), retryExpected: true };
  }
  return { ...common, status: 'unknown', retryExpected: false, requiresReconciliation: true };
}

export function summarizeSupliaBulkOutcomes(outcomes: SupliaBulkRecipientOutcome[]) {
  return {
    sent: outcomes.filter((item) => item.status === 'sent').length,
    rejected: outcomes.filter((item) => item.status === 'rejected').length,
    deferred: outcomes.filter((item) => item.status === 'deferred').length,
    transient: outcomes.filter((item) => item.status === 'transient').length,
    unknown: outcomes.filter((item) => item.status === 'unknown').length,
  };
}

function latestRetryAt(outcomes: SupliaBulkRecipientOutcome[], nowMs: number) {
  const retryTimes = outcomes
    .map((item) => item.retryAt ? Date.parse(item.retryAt) : Number.NaN)
    .filter(Number.isFinite);
  return new Date(retryTimes.length > 0 ? Math.max(...retryTimes) : nowMs + 5000).toISOString();
}

function aggregateMetadata(outcomes: SupliaBulkRecipientOutcome[], retryAt?: string) {
  const summary = summarizeSupliaBulkOutcomes(outcomes);
  return {
    outcome: summary.unknown > 0 ? 'reconciliation_required' : 'retryable',
    retryAt: retryAt || null,
    requiresReconciliation: summary.unknown > 0,
    recipientDetails: outcomes.filter((item) => item.status !== 'sent'),
    results: outcomes,
    summary,
  };
}

export function throwForIncompleteSupliaBulkOutcomes(outcomes: SupliaBulkRecipientOutcome[], nowMs = Date.now()) {
  const summary = summarizeSupliaBulkOutcomes(outcomes);
  const retryable = outcomes.filter((item) => item.status === 'deferred' || item.status === 'transient');

  if (summary.unknown > 0) {
    const retryAt = retryable.length > 0 ? latestRetryAt(retryable, nowMs) : undefined;
    throw new SupliaDeliveryReconciliationError(
      `Bulk send requiere reconciliacion manual para ${summary.unknown} destinatario${summary.unknown === 1 ? '' : 's'} con resultado desconocido.`,
      aggregateMetadata(outcomes, retryAt),
    );
  }

  if (summary.deferred > 0 || summary.transient > 0) {
    const retryAt = latestRetryAt(retryable, nowMs);
    const code = summary.deferred > 0 ? 'deferred' : 'transient';
    const label = summary.deferred > 0 ? 'diferidos' : 'con error transitorio';
    throw new SupliaRuntimeError(code, `Bulk send incompleto: ${retryable.length} destinatario${retryable.length === 1 ? '' : 's'} ${label}.`, {
      retryAfterMs: Math.max(0, Date.parse(retryAt) - nowMs),
      metadata: aggregateMetadata(outcomes, retryAt),
    });
  }
}
