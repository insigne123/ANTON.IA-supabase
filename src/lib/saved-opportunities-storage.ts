import type { JobOpportunity } from './types';

const KEY_OPPS = 'leadflow-saved-opportunities';

function getOpps(): JobOpportunity[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(KEY_OPPS);
  return raw ? JSON.parse(raw) as JobOpportunity[] : [];
}

function setOpps(opps: JobOpportunity[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_OPPS, JSON.stringify(opps));
}

function oppKey(o: JobOpportunity) {
  // id del scraper si viene; si no, combinación estable
  const base = o.id?.trim()
    || `${o.companyName || ''}|${o.title || ''}|${o.location || ''}|${o.jobUrl || ''}`;
  return base.toLowerCase();
}

export const savedOpportunitiesStorage = {
  get: getOpps,
  set: setOpps,

  addDedup(oppsToAdd: JobOpportunity[]) {
    const saved = getOpps();
    const existing = new Set(saved.map(oppKey));

    const added: JobOpportunity[] = [];
    const duplicates: JobOpportunity[] = [];

    for (const o of oppsToAdd) {
      const k = oppKey(o);
      if (existing.has(k)) duplicates.push(o);
      else { saved.push(o); added.push(o); existing.add(k); }
    }

    setOpps(saved);
    return {
      addedCount: added.length,
      duplicateCount: duplicates.length,
      added,
      duplicates,
    };
  },

  isSaved(o: JobOpportunity) {
    const saved = getOpps();
    const k = oppKey(o);
    return saved.some(s => oppKey(s) === k);
  },
};
