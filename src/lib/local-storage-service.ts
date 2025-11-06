// src/lib/local-storage-service.ts
// Maneja leads guardados (sin email). Se mantiene API existente y se añade removeWhere.

import type { Lead } from './types';

const KEY = 'leadflow-saved-leads';

function safeParse(raw: string | null): Lead[] {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

export const localStorageService = {
  getLeads(): Lead[] {
    if (typeof window === 'undefined') return [];
    return safeParse(localStorage.getItem(KEY));
  },
  setLeads(items: Lead[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(items));
  },
  addLeadsDedup(items: Lead[]) {
    const all = this.getLeads();
    const key = (v: Lead) => (v.id || `${v.name}|${v.company}|${v.title}`).toLowerCase();
    const seen = new Set(all.map(key));
    let addedCount = 0; let duplicateCount = 0;
    for (const it of items) {
      const k = key(it);
      if (!seen.has(k)) { all.unshift(it); seen.add(k); addedCount++; }
      else duplicateCount++;
    }
    this.setLeads(all);
    return { addedCount, duplicateCount };
  },
  isLeadSaved(lead: Lead): boolean {
    const all = this.getLeads();
    const k = (v: Lead) => (v.id || `${v.name}|${v.company}|${v.title}`).toLowerCase();
    const toFind = k(lead);
    return all.some(v => k(v) === toFind);
  },
  /** Elimina según predicado. Devuelve cantidad eliminada. */
  removeWhere(pred: (l: Lead) => boolean): number {
    const all = this.getLeads();
    const next = all.filter(l => !pred(l));
    this.setLeads(next);
    return all.length - next.length;
  },
};