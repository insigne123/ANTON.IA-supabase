
import { getBrowserStorage } from './browser-storage';
import { DEFAULT_DAILY_QUOTA_LIMITS } from './daily-quota-limits';

// Control visual (no de seguridad). El servidor aplica la cuota real.
export type QuotaKind = 'leadSearch' | 'enrich' | 'research' | 'contact';
export type QuotaLimits = Record<QuotaKind, number>;

const DEFAULT_LIMITS: QuotaLimits = { ...DEFAULT_DAILY_QUOTA_LIMITS };

// === IMPORTANTE ===
// El servidor usa corte de día en UTC: new Date().toISOString().slice(0, 10)
// Alineamos el cliente para evitar desincronizaciones cerca de medianoche/husos.
function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

type QuotaState = Record<QuotaKind, number>;
const EMPTY: QuotaState = { leadSearch: 0, enrich: 0, research: 0, contact: 0 };

function storageKey() {
  return `anton.quota.${todayKeyUTC()}`;
}

function limitsStorageKey() {
  return `anton.quota.limits.${todayKeyUTC()}`;
}

/** Emite un evento de cambio de cuota para re-render en UI sin polling. */
function emitQuotaChange(kind: QuotaKind, state: QuotaState, limits: QuotaLimits = getClientQuotaLimits()) {
  if (typeof window === 'undefined') return;
  const detail = { kind, state, dayKey: todayKeyUTC(), limits };
  window.dispatchEvent(new CustomEvent('quota:changed', { detail }));
}

function persistQuota(state: QuotaState) {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.setItem(storageKey(), JSON.stringify(state));
}

function persistQuotaLimits(limits: QuotaLimits) {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.setItem(limitsStorageKey(), JSON.stringify(limits));
}

export function getClientQuota(): QuotaState {
  const storage = getBrowserStorage();
  if (!storage) return { ...EMPTY };
  try {
    const raw = storage.getItem(storageKey());
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function getClientQuotaLimits(): QuotaLimits {
  const storage = getBrowserStorage();
  if (!storage) return { ...DEFAULT_LIMITS };
  try {
    const raw = storage.getItem(limitsStorageKey());
    return raw ? { ...DEFAULT_LIMITS, ...JSON.parse(raw) } : { ...DEFAULT_LIMITS };
  } catch {
    return { ...DEFAULT_LIMITS };
  }
}

export function getClientLimit(kind: QuotaKind) {
  return getClientQuotaLimits()[kind];
}

/** Comprueba si hay cupo suficiente para consumir `amount` (por defecto 1). */
export function canUseClientQuota(kind: QuotaKind, amount = 1) {
  if (amount <= 0) return true;
  const state = getClientQuota();
  const used = Number(state[kind] || 0);
  const limit = getClientLimit(kind);
  return used + amount <= limit;
}

/** Incrementa la cuota local en `amount` (por defecto 1). */
export function incClientQuota(kind: QuotaKind, amount = 1) {
  if (amount <= 0) return;
  const state = getClientQuota();
  const used = Number(state[kind] || 0);
  const next = used + amount;
  state[kind] = next;
  persistQuota(state);
  emitQuotaChange(kind, state);
}

export function setClientQuota(kind: QuotaKind, amount: number) {
  const state = getClientQuota();
  state[kind] = Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0));
  persistQuota(state);
  emitQuotaChange(kind, state);
}

export function setClientLimit(kind: QuotaKind, amount: number) {
  const limits = getClientQuotaLimits();
  limits[kind] = Math.max(1, Math.trunc(Number.isFinite(amount) ? amount : DEFAULT_LIMITS[kind]));
  persistQuotaLimits(limits);
  emitQuotaChange(kind, getClientQuota(), limits);
}

export function setClientQuotaSnapshot(kind: QuotaKind, params: { count: number; limit?: number }) {
  const state = getClientQuota();
  state[kind] = Math.max(0, Math.trunc(Number.isFinite(params.count) ? params.count : 0));
  persistQuota(state);

  const limits = getClientQuotaLimits();
  if (typeof params.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
    limits[kind] = Math.trunc(params.limit);
    persistQuotaLimits(limits);
  }

  emitQuotaChange(kind, state, limits);
}

// Utilidad opcional por si quieres resetear manualmente desde devtools
export function resetClientQuotaToday() {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.removeItem(storageKey());
  storage.removeItem(limitsStorageKey());
}

/** Suscripción simple a cambios de cuota (mismo tab). Retorna un unsubscribe. */
export function onQuotaChange(
  handler: (e: CustomEvent<{ kind: QuotaKind; state: QuotaState; dayKey: string; limits: Record<QuotaKind, number> }>) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapped = (ev: Event) => handler(ev as any);
  window.addEventListener('quota:changed', wrapped as EventListener);
  return () => window.removeEventListener('quota:changed', wrapped as EventListener);
}

/** Listado de recursos por conveniencia en UI. */
export const QUOTA_KINDS: QuotaKind[] = ['leadSearch', 'enrich', 'research', 'contact'];
