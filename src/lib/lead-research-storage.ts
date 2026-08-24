
// src/lib/lead-research-storage.ts
// Guarda reportes de investigación/cross-report.

import type { LeadResearchReport, EnhancedReport } from './types';
import { getBrowserStorage } from './browser-storage';
const LEGACY_KEY = 'leadflow-lead-research';
const STORAGE_KEY_VERSION = 2;
let activeStorageKey = '';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REPORTS = 500;

type LeadResearchCacheState = {
  version: 2;
  updatedAt: string;
  items: LeadResearchReport[];
};

function keyForScope() {
  return activeStorageKey;
}

export function setLeadResearchStorageScope(userId?: string | null, organizationId?: string | null) {
  const normalizedUserId = String(userId || '').trim().toLowerCase();
  const normalizedOrganizationId = String(organizationId || '').trim().toLowerCase();
  const nextKey = normalizedUserId
    ? `${LEGACY_KEY}:v${STORAGE_KEY_VERSION}:user:${normalizedUserId}:organization:${normalizedOrganizationId || 'personal'}`
    : '';
  if (nextKey === activeStorageKey) return;

  activeStorageKey = nextKey;
}

function sanitizeReports(items: any[]): LeadResearchReport[] {
  return (Array.isArray(items) ? items : [])
    .filter((report) => report && isReportFresh(report))
    .slice(0, MAX_REPORTS);
}

function persist(items: LeadResearchReport[]) {
  const storage = getBrowserStorage();
  const key = keyForScope();
  if (!storage || !key) return;
  const payload: LeadResearchCacheState = {
    version: STORAGE_KEY_VERSION,
    updatedAt: new Date().toISOString(),
    items: sanitizeReports(items),
  };
  storage.setItem(key, JSON.stringify(payload));
}

function isExpired(updatedAt?: string) {
  const ts = Date.parse(String(updatedAt || ''));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > CACHE_TTL_MS;
}

function getAll(): LeadResearchReport[] {
  const storage = getBrowserStorage();
  const key = keyForScope();
  if (!storage || !key) return [];
  try {
    const scopedRaw = storage.getItem(key);
    const parsed = JSON.parse(scopedRaw ?? '[]');

    if (Array.isArray(parsed)) {
      const migrated = sanitizeReports(parsed);
      persist(migrated);
      return migrated;
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      if (isExpired(parsed.updatedAt)) {
        storage.removeItem(key);
        return [];
      }

      const items = sanitizeReports(parsed.items);
      if (parsed.version !== STORAGE_KEY_VERSION || items.length !== parsed.items.length) {
        persist(items);
      }
      return items;
    }

    return [];
  } catch {
    return [];
  }
}

function setAll(items: LeadResearchReport[]) {
  if (!getBrowserStorage() || !keyForScope()) return;
  persist(items);
}

function isReportFresh(report: LeadResearchReport) {
  const ts = Date.parse(String(report?.createdAt || ''));
  return Number.isFinite(ts) && Date.now() - ts >= 0 && Date.now() - ts <= CACHE_TTL_MS;
}

// Reuse is safe only for the exact lead identity supplied by the caller.
export function findReportForLead(opts: {
  leadId?: string;
  email?: string | null;
  companyDomain?: string | null;
  companyName?: string | null;
}): LeadResearchReport | null {
  if (!getBrowserStorage()) return null;
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
  const email = String(opts.email || '').trim().toLowerCase();
  if (!email) return null;
  return arr.find(r => String(r.meta?.leadRef || '').trim().toLowerCase() === email) || null;
}

export function upsertLeadReports(newOnes: LeadResearchReport[]) {
  if (!getBrowserStorage() || !keyForScope()) return;
  const cur = getAll();
  const normalized = (newOnes || []).filter(r => String(r?.meta?.leadRef || '').trim());
  const all = [...normalized, ...cur];
  const seen = new Set<string>();
  const dedup = all.filter(r => {
    const k = String(r.meta?.leadRef || '').trim();
    if (!k) return false;
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
  const idx = cur.findIndex(r => r.meta?.leadRef === leadRefOrDomain);
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
  if (!getBrowserStorage()) return null;
  const ref = (leadRef || '').trim();
  if (!ref) return null;
  const arr = getAll();
  return arr.find(r => (r.meta?.leadRef || '') === ref) || null;
}
/** Elimina reportes para una ref. */
export function removeReportFor(leadRef: string | undefined | null) {
  if (!getBrowserStorage()) return 0;
  const ref = (leadRef || '').trim();
  if (!ref) return 0;
  return leadResearchStorage.removeWhere(r => (r.meta?.leadRef || '') === ref);
}
