// src/lib/saved-enriched-opps-storage.ts
// Almacén local para contactos enriquecidos provenientes de Oportunidades.

import type { EnrichedOppLead } from './types';

const KEY = 'anton.saved.enriched.opps.v1';

function load(): EnrichedOppLead[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list: EnrichedOppLead[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[saved-enriched-opps] save failed', (e as any)?.message);
  }
}

/** Clave de deduplicación robusta */
function refOf(x: EnrichedOppLead): string {
  const id = (x.id || '').trim();
  const email = (x as any).email ? String((x as any).email).trim().toLowerCase() : '';
  const li = (x as any).linkedinUrl ? String((x as any).linkedinUrl).trim().toLowerCase() : '';
  const name = (x.fullName || '').trim().toLowerCase();
  const dom = (x.companyDomain || '').trim().toLowerCase();
  return id || email || li || `${name}|${dom}`;
}

export function getEnrichedOppLeads(): EnrichedOppLead[] {
  return load();
}

/** === NUEVO: alta con dedupe por id/email/linkedin === */
function normEmail(e?: string) {
  return (e || '').trim().toLowerCase();
}
function normLinkedin(u?: string) {
  if (!u) return '';
  try {
    const url = new URL(u.startsWith('http') ? u : `https://${u}`);
    url.protocol = 'https:'; url.hostname = 'www.linkedin.com';
    return url.toString().replace(/\/+$/,'');
  } catch {
    return u.trim().toLowerCase();
  }
}
export function addEnrichedOppLeadsDedup(items: EnrichedOppLead[]) {
  if (!Array.isArray(items) || items.length === 0) return;
  const cur = load();

  const byId = new Map<string, EnrichedOppLead>(cur.map(x => [x.id, x]));
  const byEmail = new Map<string, EnrichedOppLead>();
  cur.forEach(x => {
    const email = normEmail((x as any).email);
    if (email) byEmail.set(email, x);
  });
  const byLi = new Map<string, EnrichedOppLead>();
  cur.forEach(x => {
    const li = normLinkedin((x as any).linkedinUrl);
    if (li) byLi.set(li, x);
  });
  

  for (const it of items) {
    const id = it.id;
    const email = normEmail((it as any).email);
    const li = normLinkedin((it as any).linkedinUrl);

    const found =
      (id && byId.get(id)) ||
      (email && byEmail.get(email)) ||
      (li && byLi.get(li));

    if (found) {
      const merged = { ...found, ...it };
      byId.set(merged.id, merged);
      if (email) byEmail.set(email, merged);
      if (li) byLi.set(li, merged);
    } else {
      byId.set(id, it);
      if (email) byEmail.set(email, it);
      if (li) byLi.set(li, it);
    }
  }

  const next = Array.from(byId.values());
  save(next);
}

/** Elimina varios por id y devuelve el nuevo listado */
export function removeEnrichedOppLeadsByIds(ids: string[]): EnrichedOppLead[] {
  if (!Array.isArray(ids) || ids.length === 0) return load();
  const set = new Set(ids.filter(Boolean));
  const next = load().filter(x => !set.has(x.id));
  save(next);
  return next;
}

/** Elimina uno por id y devuelve el nuevo listado */
export function removeEnrichedOppLeadById(id: string): EnrichedOppLead[] {
  return removeEnrichedOppLeadsByIds([id]);
}

/** Elimina por predicado. Devuelve cantidad eliminada. */
export function removeWhereOpp(pred: (e: EnrichedOppLead) => boolean): number {
  const all = getEnrichedOppLeads();
  const next = all.filter(e => !pred(e));
  save(next);
  return all.length - next.length;
}

export function setEnrichedOppLeads(items: EnrichedOppLead[]) {
  if (typeof window === 'undefined') return;
  save(items);
}
