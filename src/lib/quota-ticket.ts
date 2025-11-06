// Guarda/recupera el "quota ticket" firmado que envía el backend cuando
// está en fallback de cuota (sin Firestore). Es stateless y funciona en serverless.

const KEY = 'quota_ticket_v1';

export function getQuotaTicket(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setQuotaTicket(token?: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!token) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, token);
  } catch {}
}
