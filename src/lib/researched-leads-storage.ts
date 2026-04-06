// src/lib/researched-leads-storage.ts
// Marca qué leads ya fueron investigados (por ref). Permite marcar, desmarcar y limpiar todo.

const KEY = 'leadflow-researched-leads';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REFS = 5000;

type ResearchedLeadCacheState = {
  version: 1;
  updatedAt: string;
  refs: string[];
};

function normalizeRef(ref: string): string {
  return String(ref || '').trim().toLowerCase();
}

function getAll(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      const normalized = Array.from(new Set(parsed.filter(Boolean).map((s: any) => normalizeRef(String(s))))).slice(0, MAX_REFS);
      setAll(normalized);
      return normalized;
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.refs)) {
      const ts = Date.parse(String(parsed.updatedAt || ''));
      if (Number.isFinite(ts) && Date.now() - ts > CACHE_TTL_MS) {
        localStorage.removeItem(KEY);
        return [];
      }

      const normalized = parsed.refs.filter(Boolean).map((s: any) => normalizeRef(String(s)));
      return Array.from(new Set<string>(normalized)).slice(0, MAX_REFS);
    }

    return [];
  } catch {
    return [];
  }
}

function setAll(refs: string[]) {
  if (typeof window === 'undefined') return;
  // Guardamos siempre normalizado
  const uniq = Array.from(new Set((refs || []).filter(Boolean).map(normalizeRef))).slice(0, MAX_REFS);
  const payload: ResearchedLeadCacheState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    refs: uniq,
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

/** Devuelve true si la ref está marcada como investigada. */
export function isResearched(ref: string): boolean {
  const all = getAll();
  const r = normalizeRef(ref);
  if (!r) return false;
  const set = new Set(all);
  return set.has(r);
}

/** Marca una lista de refs como investigadas (idempotente). */
export function markResearched(refs: string[] = []) {
  const all = getAll();
  const set = new Set(all);
  for (const r of refs || []) {
    const v = normalizeRef(r);
    if (v) set.add(v);
  }
  setAll(Array.from(set));
}

/** Desmarca una lista de refs (idempotente). */
export function unmarkResearched(refs: string[] = []) {
  if (!refs?.length) return;
  const remove = new Set(refs.map(normalizeRef).filter(Boolean));
  const next = getAll().filter(r => !remove.has(r));
  setAll(next);
}

/** Borra todas las marcas. */
export function clearAllResearched() {
  setAll([]);
}

export const removeResearched = unmarkResearched;
