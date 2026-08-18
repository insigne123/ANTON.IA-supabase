// src/lib/researched-leads-storage.ts
// Marca qué leads ya fueron investigados (por ref). Permite marcar, desmarcar y limpiar todo.

import { getBrowserStorage } from './browser-storage';

const LEGACY_KEY = 'leadflow-researched-leads';
let activeScope = '';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REFS = 5000;

type ResearchedLeadCacheState = {
  version: 1;
  updatedAt: string;
  refs: string[];
};

function keyForScope() {
  return activeScope ? `${LEGACY_KEY}:${activeScope}` : '';
}

export function setResearchedLeadsStorageScope(userId?: string | null) {
  activeScope = String(userId || '').trim().toLowerCase();
}

function normalizeRef(ref: string): string {
  return String(ref || '').trim().toLowerCase();
}

function getAll(): string[] {
  const storage = getBrowserStorage();
  const key = keyForScope();
  if (!storage || !key) return [];
  try {
    const scopedRaw = storage.getItem(key);
    const legacyRaw = scopedRaw == null ? storage.getItem(LEGACY_KEY) : null;
    const raw = scopedRaw ?? legacyRaw;
    if (legacyRaw != null) storage.removeItem(LEGACY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      const normalized = Array.from(new Set(parsed.filter(Boolean).map((s: any) => normalizeRef(String(s))))).slice(0, MAX_REFS);
      setAll(normalized);
      return normalized;
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.refs)) {
      const ts = Date.parse(String(parsed.updatedAt || ''));
      if (Number.isFinite(ts) && Date.now() - ts > CACHE_TTL_MS) {
        storage.removeItem(key);
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
  const storage = getBrowserStorage();
  const key = keyForScope();
  if (!storage || !key) return;
  // Guardamos siempre normalizado
  const uniq = Array.from(new Set((refs || []).filter(Boolean).map(normalizeRef))).slice(0, MAX_REFS);
  const payload: ResearchedLeadCacheState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    refs: uniq,
  };
  storage.setItem(key, JSON.stringify(payload));
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
