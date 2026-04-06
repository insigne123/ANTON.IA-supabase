// src/lib/enriched-leads-storage.ts
import type { EnrichedLead } from './types';
import { v4 as uuidv4 } from 'uuid';

const KEY = 'leadflow-enriched-leads';

function load(): EnrichedLead[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

function save(all: EnrichedLead[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(all));
}

function keyOf(l: EnrichedLead) {
  const base =
    l.id?.trim() ||
    (l.email?.trim() || '') ||
    `${l.fullName || ''}|${l.companyDomain || l.companyName || ''}|${l.title || ''}`;
  return base.toLowerCase();
}

export const enrichedLeadsStorage = {
  get: load,
  set: save,
  addDedup(newOnes: EnrichedLead[]) {
    const cur = load().map(l => ({ ...l, id: l.id || uuidv4() }));
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
    save(cur);
    return { addedCount: added.length, duplicateCount: dups.length, added, duplicates: dups };
  },
  isSaved(l: EnrichedLead) {
    return load().some(x => keyOf(x) === keyOf(l));
  },
  removeById(id: string) {
    const items = load().filter(l => l.id !== id);
    save(items);
    return { removed: true, remaining: items.length };
  }
};
