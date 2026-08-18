// Guarda/recupera el "quota ticket" firmado que envía el backend cuando
// está en fallback de cuota (sin Firestore). Es stateless y funciona en serverless.

import { getBrowserStorage } from './browser-storage';

const KEY = 'quota_ticket_v1';

export function getQuotaTicket(): string | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try { return storage.getItem(KEY); } catch { return null; }
}

export function setQuotaTicket(token?: string | null) {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    if (!token) storage.removeItem(KEY);
    else storage.setItem(KEY, token);
  } catch {}
}
