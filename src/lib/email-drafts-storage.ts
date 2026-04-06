// src/lib/email-drafts-storage.ts
// Persistencia de borradores editados por leadId

export type DraftOverride = { subject: string; body: string; updatedAt: string };
const KEY = 'leadflow-email-drafts';

function getAll(): Record<string, DraftOverride> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function setAll(map: Record<string, DraftOverride>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export const emailDraftsStorage = {
  get(leadId: string): DraftOverride | undefined {
    const all = getAll();
    return all[leadId];
  },
  set(leadId: string, subject: string, body: string) {
    const all = getAll();
    all[leadId] = { subject, body, updatedAt: new Date().toISOString() };
    setAll(all);
  },
  remove(leadId: string) {
    const all = getAll();
    delete all[leadId];
    setAll(all);
  },
  clear() { setAll({}); },
  getMap(): Record<string, DraftOverride> { return getAll(); },
};
