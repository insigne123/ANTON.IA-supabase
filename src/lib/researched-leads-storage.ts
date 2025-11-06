// src/lib/researched-leads-storage.ts
// Marca qué leads ya fueron investigados (por ref). Permite marcar, desmarcar y limpiar todo.

const KEY = 'leadflow-researched-leads';

function normalizeRef(ref: string): string {
  return String(ref || '').trim().toLowerCase();
}

function getAll(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      // Normalizamos TODO lo histórico al cargar
      return arr.filter(Boolean).map((s: any) => normalizeRef(String(s)));
    }
    return [];
  } catch {
    return [];
  }
}

function setAll(refs: string[]) {
  if (typeof window === 'undefined') return;
  // Guardamos siempre normalizado
  const uniq = Array.from(new Set((refs || []).filter(Boolean).map(normalizeRef)));
  localStorage.setItem(KEY, JSON.stringify(uniq));
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
