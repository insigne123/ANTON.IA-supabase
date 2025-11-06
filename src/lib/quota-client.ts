
// Control visual (no de seguridad). El servidor aplica la cuota real.
export type QuotaKind = 'leadSearch' | 'enrich' | 'research' | 'contact';

// Ajusta los límites si corresponde
const LIMITS: Record<QuotaKind, number> = {
  leadSearch: 50,
  enrich: 50, // límite de Enriquecimiento
  research: 50,
  contact: 50,
};

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

/** Emite un evento de cambio de cuota para re-render en UI sin polling. */
function emitQuotaChange(kind: QuotaKind, state: QuotaState) {
  if (typeof window === 'undefined') return;
  const detail = { kind, state, dayKey: todayKeyUTC(), limits: LIMITS };
  window.dispatchEvent(new CustomEvent('quota:changed', { detail }));
}

export function getClientQuota(): QuotaState {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function getClientLimit(kind: QuotaKind) {
  return LIMITS[kind];
}

/** Comprueba si hay cupo suficiente para consumir `amount` (por defecto 1). */
export function canUseClientQuota(kind: QuotaKind, amount = 1) {
  if (amount <= 0) return true;
  const state = getClientQuota();
  const used = Number(state[kind] || 0);
  const limit = LIMITS[kind];
  return used + amount <= limit;
}

/** Incrementa la cuota local en `amount` (por defecto 1). */
export function incClientQuota(kind: QuotaKind, amount = 1) {
  if (amount <= 0) return;
  const key = storageKey();
  const state = getClientQuota();
  const used = Number(state[kind] || 0);
  const next = used + amount;
  state[kind] = next;
  localStorage.setItem(key, JSON.stringify(state));
  emitQuotaChange(kind, state);
}

// Utilidad opcional por si quieres resetear manualmente desde devtools
export function resetClientQuotaToday() {
  localStorage.removeItem(storageKey());
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
