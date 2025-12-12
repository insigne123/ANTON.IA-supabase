
// src/lib/lead-research-storage.ts
// Guarda reportes de investigación/cross-report.

import type { LeadResearchReport, EnhancedReport } from './types';
const KEY = 'leadflow-lead-research';

function getAll(): LeadResearchReport[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function setAll(items: LeadResearchReport[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

// Ampliamos búsqueda: acepta una "leadRef" flexible (id/email/compuesto) y fallback por dominio/nombre.
export function findReportForLead(opts: {
  leadId?: string;
  companyDomain?: string | null;
  companyName?: string | null;
}): LeadResearchReport | null {
  if (typeof window === 'undefined') return null;
  const arr = getAll();
  // Normalizamos trim y lowercase para evitar misses por casing
  const leadRefRaw = (opts.leadId || '').trim();
  const leadRefLower = leadRefRaw.toLowerCase();
  const byRef = leadRefRaw
    ? arr.find(r => {
      const k = (r.meta?.leadRef || '').trim();
      return k === leadRefRaw || k.toLowerCase() === leadRefLower;
    })
    : null;
  if (byRef) return byRef;
  const byDomain = opts.companyDomain ? arr.find(r => r.company.domain === opts.companyDomain) : null;
  if (byDomain) return byDomain;
  const byName = opts.companyName ? arr.find(r => (r.company.name || '').toLowerCase() === opts.companyName!.toLowerCase()) : null;
  return byName || null;
}

export function upsertLeadReports(newOnes: LeadResearchReport[]) {
  if (typeof window === 'undefined') return;
  const cur = getAll();
  // Normaliza meta.leadRef vacío si fuese necesario (lo haremos más consistente en el caller también).
  const normalized = (newOnes || []).map(r => {
    if (!r?.meta) r.meta = {};
    if (!r.meta.leadRef) {
      // Fallback minimalista: usa dominio o nombre+fecha como referencia
      r.meta.leadRef = r.meta.leadRef
        || (r.company?.domain ? `d:${r.company.domain}` : '')
        || `n:${(r.company?.name || '').toLowerCase()}:${r.createdAt}`;
    }
    return r;
  });
  const all = [...normalized, ...cur];
  // de-dupe por (meta.leadRef || company.domain || company.name + createdAt)
  const seen = new Set<string>();
  const dedup = all.filter(r => {
    const k = r.meta?.leadRef
      || (r.company.domain ? `d:${r.company.domain}` : '')
      || `n:${(r.company.name || '').toLowerCase()}:${r.createdAt}`;
    if (k && seen.has(k)) return false;
    if (k) seen.add(k);
    return true;
  });
  setAll(dedup);
}

export const leadResearchStorage = {
  getAll,
  setAll,
  add(r: LeadResearchReport) {
    const all = getAll();
    all.unshift(r);
    setAll(all);
  },
  /** Elimina por predicado. Devuelve cantidad eliminada. */
  removeWhere(pred: (r: LeadResearchReport) => boolean): number {
    const all = getAll();
    const next = all.filter(r => !pred(r));
    setAll(next);
    return all.length - next.length;
  },
};

export function upsertEnhancedReport(leadRefOrDomain: string, enhanced: EnhancedReport) {
  const cur = getAll();
  const idx = cur.findIndex(r =>
    r.meta?.leadRef === leadRefOrDomain ||
    r.company.domain === leadRefOrDomain
  );
  if (idx >= 0) {
    cur[idx].enhanced = enhanced;
    setAll(cur);
  }
}

export function getLeadReports(): LeadResearchReport[] {
  return getAll();
}

/** Busca SOLO por referencia de lead (sin fallback por dominio/nombre). */
export function findReportByRef(leadRef: string | undefined | null): LeadResearchReport | null {
  if (typeof window === 'undefined') return null;
  const ref = (leadRef || '').trim();
  if (!ref) return null;
  const arr = getAll();
  return arr.find(r => (r.meta?.leadRef || '') === ref) || null;
}
/** Elimina reportes para una ref. */
export function removeReportFor(leadRef: string | undefined | null) {
  if (typeof window === 'undefined') return 0;
  const ref = (leadRef || '').trim();
  if (!ref) return 0;
  return leadResearchStorage.removeWhere(r => (r.meta?.leadRef || '') === ref);
}
