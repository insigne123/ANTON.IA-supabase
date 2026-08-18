// src/lib/email-drafts-storage.ts
// Persistencia de borradores editados por leadId

import { getBrowserStorage } from './browser-storage';

export type DraftOverride = { subject: string; body: string; updatedAt: string };
const LEGACY_KEY = 'leadflow-email-drafts';
let activeScope = '';

function keyForScope() {
  return activeScope ? `${LEGACY_KEY}:${activeScope}` : '';
}

export function setEmailDraftStorageScope(userId?: string | null) {
  activeScope = String(userId || '').trim().toLowerCase();
}

function getAll(): Record<string, DraftOverride> {
  const storage = getBrowserStorage();
  const key = keyForScope();
  if (!storage || !key) return {};
  try {
    const scopedRaw = storage.getItem(key);
    const legacyRaw = scopedRaw == null ? storage.getItem(LEGACY_KEY) : null;
    const parsed = JSON.parse(scopedRaw ?? legacyRaw ?? '{}');
    if (legacyRaw != null) {
      storage.setItem(key, JSON.stringify(parsed));
      storage.removeItem(LEGACY_KEY);
    }
    return parsed;
  } catch { return {}; }
}
function setAll(map: Record<string, DraftOverride>) {
  const storage = getBrowserStorage();
  const key = keyForScope();
  if (!storage || !key) return;
  storage.setItem(key, JSON.stringify(map));
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
