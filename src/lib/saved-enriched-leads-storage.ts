// src/lib/saved-enriched-leads-storage.ts
import type { EnrichedLead } from './types';
import { v4 as uuidv4 } from 'uuid';

const KEY = 'leadflow-enriched-leads';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function parseAll(): any[] {
  if (!isBrowser()) return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function sanitize(items: any[]): EnrichedLead[] {
  return (items || []).map((x: any) => {
    const email = x.email; // Simplified, assuming email is clean
    const out: EnrichedLead = {
      id: x.id,
      sourceOpportunityId: x.sourceOpportunityId,
      fullName: x.fullName || x.name,
      title: x.title,
      email: email ?? x.email, // normalizamos
      emailStatus: email ? (x.emailStatus || 'unknown') : x.emailStatus,
      linkedinUrl: x.linkedinUrl || x.linkedin_url,
      companyName: x.companyName || x.company,
      companyDomain: x.companyDomain,
      descriptionSnippet: x.descriptionSnippet,
      createdAt: x.createdAt || new Date().toISOString(),
      country: x.country,
      city: x.city,
      industry: x.industry,
    };
    return out;
  });
}

export function getEnrichedLeads(): EnrichedLead[] {
  if (!isBrowser()) return [];
  const parsed = parseAll();
  const sanitized = sanitize(parsed);
  // if changed, re-save (local migration)
  if (isBrowser() && JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
    localStorage.setItem(KEY, JSON.stringify(sanitized));
  }
  return sanitized;
}

export function setEnrichedLeads(items: EnrichedLead[]) {
  if (!isBrowser()) return;
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function addEnrichedLeads(items: EnrichedLead[]) {
  if (!isBrowser()) return;
  const all = getEnrichedLeads();
  const key = (v: EnrichedLead) => (v.id || v.email || `${v.fullName}|${v.companyName}|${v.title}`).toLowerCase();
  const seen = new Set(all.map(key));
  for (const it of items.map(i => sanitize([i])[0])) {
    const k = key(it);
    if (!seen.has(k)) { all.unshift(it); seen.add(k); }
  }
  setEnrichedLeads(all);
}

/** Elimina por predicado. Devuelve cantidad eliminada. */
export function removeWhere(pred: (e: EnrichedLead) => boolean): number {
  if (!isBrowser()) return 0;
  const all = getEnrichedLeads();
  const next = all.filter(e => !pred(e));
  setEnrichedLeads(next);
  return all.length - next.length;
}

export function findEnrichedLeadById(id: string): EnrichedLead | undefined {
  if (!isBrowser()) return undefined;
  return getEnrichedLeads().find((x) => x.id === id);
}

export function removeEnrichedLeadById(id: string) {
  if (!isBrowser()) return [];
  const all = getEnrichedLeads().filter((x) => x.id !== id);
  setEnrichedLeads(all);
  return all;
}

export const enrichedLeadsStorage = {
  get: getEnrichedLeads,
  set: setEnrichedLeads,
  addDedup(newOnes: EnrichedLead[]) {
    if (!isBrowser()) return { addedCount: 0, duplicateCount: 0, added: [], duplicates: [] };
    const cur = getEnrichedLeads().map(l => ({ ...l, id: l.id || uuidv4() }));
    const keyOf = (l: EnrichedLead) => (l.id?.trim() || (l.email?.trim() || '') || `${l.fullName || ''}|${l.companyDomain || l.companyName || ''}|${l.title || ''}`).toLowerCase();
    const seen = new Set(cur.map(keyOf));
    const added: EnrichedLead[] = [];
    const dups: EnrichedLead[] = [];

    for (const raw of newOnes) {
      const l = { ...raw, id: raw.id || uuidv4() };
      const k = keyOf(l);
      if (!k || seen.has(k)) { dups.push(l); continue; }
      cur.push(l);
      seen.add(k);
      added.push(l);
    }
    setEnrichedLeads(cur);
    return { addedCount: added.length, duplicateCount: dups.length, added, duplicates: dups };
  },
  isSaved(l: EnrichedLead) {
    if (!isBrowser()) return false;
    const keyOf = (l: EnrichedLead) => (l.id?.trim() || (l.email?.trim() || '') || `${l.fullName || ''}|${l.companyDomain || l.companyName || ''}|${l.title || ''}`).toLowerCase();
    return getEnrichedLeads().some(x => keyOf(x) === keyOf(l));
  },
  removeById(id: string) {
    if (!isBrowser()) return { removed: false, remaining: 0 };
    const items = getEnrichedLeads().filter(l => l.id !== id);
    setEnrichedLeads(items);
    return { removed: true, remaining: items.length };
  }
};
