export type DurableDispatchStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'deferred' | 'unknown';

export type DurableDispatchRetry = {
  retryable: true;
  phase?: 'pre_provider' | 'provider_deferred' | string;
  code?: string | null;
  retryAt?: string | null;
  retryAfterMs?: number | null;
};

export type DurableDispatchError = {
  code: string | null;
  message: string | null;
};

export type DurableSendReceipt = {
  dispatchId: string;
  status: DurableDispatchStatus;
  replayed: boolean;
  providerMessageId: string | null;
  retry?: DurableDispatchRetry;
  error?: DurableDispatchError;
};

const durableStatuses = new Set<DurableDispatchStatus>([
  'pending',
  'sending',
  'sent',
  'failed',
  'deferred',
  'unknown',
]);

function optionalText(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

export function mapDurableSendReceipt(payload: unknown): DurableSendReceipt | null {
  if (!payload || typeof payload !== 'object') return null;

  const body = payload as Record<string, any>;
  const rawReceipt = body.receipt;
  if (!rawReceipt || typeof rawReceipt !== 'object') return null;

  const receipt = rawReceipt as Record<string, any>;
  const dispatchId = optionalText(receipt.dispatchId);
  const normalizedStatus = optionalText(receipt.status ?? body.status)?.toLowerCase() as DurableDispatchStatus | undefined;
  if (!dispatchId || !normalizedStatus || !durableStatuses.has(normalizedStatus)) return null;

  const retry = receipt.retry && typeof receipt.retry === 'object' && receipt.retry.retryable === true
    ? { ...receipt.retry, retryable: true } as DurableDispatchRetry
    : undefined;
  const errorCode = optionalText(receipt.errorCode ?? body.code);
  const errorMessage = optionalText(receipt.errorMessage ?? body.error ?? body.message);

  return {
    dispatchId,
    status: normalizedStatus,
    replayed: receipt.replayed === true || body.replayed === true,
    providerMessageId: optionalText(receipt.providerMessageId),
    ...(retry ? { retry } : {}),
    ...(errorCode || errorMessage ? { error: { code: errorCode, message: errorMessage } } : {}),
  };
}
