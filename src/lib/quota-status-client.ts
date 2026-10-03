/**
 * One /api/quota/status request for every reader that asks within `maxAgeMs`: the shell's QuotaSync, «Uso diario» and
 * «Créditos» mounted together on «Hoy» used to fetch it three times on every visit.
 */
type QuotaStatusPayload = Record<string, unknown>;

let shared: { at: number; promise: Promise<QuotaStatusPayload> } | null = null;

export function fetchQuotaStatus({ maxAgeMs = 3000, force = false, fetchImpl = fetch }: {
  maxAgeMs?: number;
  /** A person pressed «Actualizar»: always ask again. */
  force?: boolean;
  fetchImpl?: typeof fetch;
} = {}): Promise<QuotaStatusPayload> {
  const now = Date.now();
  if (!force && shared && now - shared.at < maxAgeMs) return shared.promise;
  const promise = fetchImpl('/api/quota/status', { method: 'GET', cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error(`QUOTA_STATUS_${response.status}`);
    return (await response.json()) as QuotaStatusPayload;
  });
  const entry = { at: now, promise };
  shared = entry;
  // A failure is not shared with the next reader: it asks again.
  promise.catch(() => { if (shared === entry) shared = null; });
  return promise;
}

/** For tests: forget the shared answer. */
export function resetQuotaStatusCache() {
  shared = null;
}
