/**
 * «Revisar y enviar en serie» (plan de uso A1, audit T1): the ready drafts of «Por escribir» one after another. Each one is still
 * reviewed and sent on its own page (/contact/compose?draftId=…), with every check that page makes; the queue only remembers the
 * order, so that after a send, or a skip, the next one opens with one click instead of going back to the list. It lives in the
 * tab (sessionStorage) for a working session and is never the reason anything is sent.
 */

export const DRAFT_QUEUE_KEY = 'anton.draft-queue.v1';
/** A queue older than this was left behind: it is not offered again. */
export const DRAFT_QUEUE_MAX_AGE_MS = 12 * 3_600_000;
/** How many drafts one pass takes. */
export const DRAFT_QUEUE_MAX = 50;

export type DraftQueue = { ids: string[]; savedAt: number };
export type DraftQueuePlace = { position: number; total: number; nextId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const composeDraftHref = (draftId: string) => `/contact/compose?draftId=${encodeURIComponent(draftId)}`;
export const DRAFTS_STAGE_HREF = '/saved/leads/enriched?etapa=draft_ready';

/** The ids kept: valid, once each, in the order given, at most DRAFT_QUEUE_MAX. */
export function cleanQueueIds(ids: Iterable<string>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= DRAFT_QUEUE_MAX) break;
  }
  return out;
}

/** A stored queue, or null when it is missing, malformed or too old. */
export function parseDraftQueue(raw: string | null | undefined, now = Date.now()): DraftQueue | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DraftQueue>;
    const ids = Array.isArray(value?.ids) ? cleanQueueIds(value.ids as string[]) : [];
    const savedAt = typeof value?.savedAt === 'number' ? value.savedAt : Number.NaN;
    if (!ids.length || !Number.isFinite(savedAt) || savedAt > now + 60_000 || now - savedAt > DRAFT_QUEUE_MAX_AGE_MS) return null;
    return { ids, savedAt };
  } catch {
    return null;
  }
}

/** Where a draft is in the queue, and the one after it; null when it is not in it. */
export function queuePlace(queue: DraftQueue | null, draftId: string | null | undefined): DraftQueuePlace | null {
  if (!queue || !draftId) return null;
  const index = queue.ids.indexOf(draftId);
  if (index < 0) return null;
  return { position: index + 1, total: queue.ids.length, nextId: queue.ids[index + 1] ?? null };
}

/** «Borrador 2 de 5». */
export const queueLabel = (place: DraftQueuePlace) => `Borrador ${place.position.toLocaleString('es-CL')} de ${place.total.toLocaleString('es-CL')}`;

export function saveDraftQueue(ids: Iterable<string>, now = Date.now()) {
  const clean = cleanQueueIds(ids);
  if (!clean.length) return null;
  try {
    window.sessionStorage.setItem(DRAFT_QUEUE_KEY, JSON.stringify({ ids: clean, savedAt: now }));
  } catch {
    // Without storage the first draft still opens; the next ones are reached from the list, as before.
  }
  return clean;
}

export function readDraftQueue(now = Date.now()) {
  try {
    return parseDraftQueue(window.sessionStorage.getItem(DRAFT_QUEUE_KEY), now);
  } catch {
    return null;
  }
}

export function clearDraftQueue() {
  try { window.sessionStorage.removeItem(DRAFT_QUEUE_KEY); } catch { /* nothing kept, nothing to clear */ }
}
