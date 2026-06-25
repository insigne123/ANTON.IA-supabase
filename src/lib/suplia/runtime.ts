export type SupliaRuntimeErrorCode = 'cancelled' | 'paused' | 'deferred' | 'timeout' | 'transient' | 'rate_limited';

export class SupliaRuntimeError extends Error {
  code: SupliaRuntimeErrorCode;
  retryAfterMs?: number;
  metadata?: Record<string, unknown>;

  constructor(code: SupliaRuntimeErrorCode, message: string, options: { retryAfterMs?: number; metadata?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'SupliaRuntimeError';
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.metadata = options.metadata;
  }
}

export function isSupliaRuntimeError(error: unknown, code?: SupliaRuntimeErrorCode) {
  const runtimeError = error instanceof SupliaRuntimeError;
  if (!runtimeError) return false;
  return code ? error.code === code : true;
}

export function getSupliaRuntimeErrorCode(error: unknown): SupliaRuntimeErrorCode | null {
  return error instanceof SupliaRuntimeError ? error.code : null;
}

export function getSupliaRetryAfterMs(error: unknown, fallback = 5000) {
  if (error instanceof SupliaRuntimeError && Number.isFinite(error.retryAfterMs)) return Math.max(0, Number(error.retryAfterMs));
  return fallback;
}

export function isSupliaTransientError(error: unknown) {
  if (error instanceof SupliaRuntimeError) return ['deferred', 'rate_limited', 'timeout', 'transient'].includes(error.code);
  const text = String((error as any)?.message || error || '').toLowerCase();
  return text.includes('429') || text.includes('rate limit') || text.includes('temporarily unavailable') || text.includes('timeout');
}
