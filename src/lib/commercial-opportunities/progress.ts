// What each card of the pipeline says about its own work, so coming back from an opportunity is not coming back to nothing:
// whether it is being researched, whether its report is ready, and when this person opened it. Pure: the server builds the
// first two from its jobs and reports, the browser keeps the third, and the card reads them with the same words.
import { relativeTime } from './view';

export const RESEARCH_ACTIVE = ['queued', 'running', 'waiting'] as const;
const RESEARCH_STATES = [...RESEARCH_ACTIVE, 'ready', 'failed', 'blocked'] as const;
export type ResearchState = typeof RESEARCH_STATES[number];
export type CardProgress = { research?: ResearchState | null; researchAt?: string | null; reportAt?: string | null };

export const isResearching = (progress: CardProgress | null | undefined) => RESEARCH_ACTIVE.includes(progress?.research as typeof RESEARCH_ACTIVE[number]);

type JobRow = { opportunity_id?: string | null; state?: string | null; updated_at?: string | null };
type ReportRow = { opportunity_id?: string | null; created_at?: string | null };
const time = (value: string | null | undefined) => { const at = Date.parse(String(value ?? '')); return Number.isFinite(at) ? at : -Infinity; };

/** For the opportunities asked, the latest research job and the latest report of each; the ones with neither are left out. */
export function buildProgress(jobs: JobRow[], reports: ReportRow[], ids: Iterable<string>): Record<string, CardProgress> {
  const wanted = new Set(ids);
  const progress: Record<string, CardProgress> = {};
  for (const job of jobs) {
    const id = String(job.opportunity_id ?? '');
    const state = RESEARCH_STATES.find(item => item === job.state);
    if (!wanted.has(id) || !state) continue;
    const current = progress[id];
    if (!current || time(job.updated_at) > time(current.researchAt)) progress[id] = { ...current, research: state, researchAt: job.updated_at ?? null };
  }
  for (const report of reports) {
    const id = String(report.opportunity_id ?? '');
    if (!wanted.has(id) || !Number.isFinite(time(report.created_at))) continue;
    const current = progress[id];
    if (!current?.reportAt || time(report.created_at) > time(current.reportAt)) progress[id] = { ...current, reportAt: report.created_at ?? null };
  }
  return progress;
}

export type ProgressChip = { key: 'research' | 'report' | 'opened'; label: string; tone: 'active' | 'done' | 'warning' | 'quiet'; title: string };

/**
 * The marks of a card, the state first: researching now; the research failed or stopped; the report is ready and since when.
 * Then, when this person opened it from this browser, how long ago. Nothing when there is nothing to say.
 */
export function progressChips(progress: CardProgress | null | undefined, openedAt: number | null | undefined, now = Date.now()): ProgressChip[] {
  const chips: ProgressChip[] = [];
  const since = (value: string | null | undefined) => (value && Number.isFinite(Date.parse(value)) ? relativeTime(value, now) : '');
  if (isResearching(progress)) chips.push({ key: 'research', label: 'Investigando…', tone: 'active', title: `La investigación empezó ${since(progress?.researchAt) || 'hace poco'}. Se actualiza sola.` });
  else if (progress?.research === 'failed') chips.push({ key: 'research', label: 'Investigación fallida', tone: 'warning', title: 'La investigación no terminó. Ábrela para volver a intentarlo.' });
  else if (progress?.research === 'blocked') chips.push({ key: 'research', label: 'Investigación detenida', tone: 'warning', title: 'La investigación quedó detenida. Ábrela para ver por qué.' });
  else if (progress?.reportAt || progress?.research === 'ready') {
    const when = since(progress?.reportAt || progress?.researchAt);
    chips.push({ key: 'report', label: when ? `Informe listo · ${when}` : 'Informe listo', tone: 'done', title: 'La investigación terminó: ábrela para leer el informe.' });
  }
  if (typeof openedAt === 'number' && Number.isFinite(openedAt) && openedAt <= now + 60_000) {
    chips.push({ key: 'opened', label: `Abierta ${relativeTime(new Date(openedAt).toISOString(), now)}`, tone: 'quiet', title: 'La abriste desde este navegador.' });
  }
  return chips;
}

// ─── When this person opened each one: kept in the browser, per person, and never needed for anything else ───────────────────────

export const OPENED_LIMIT = 400;
export const openedKey = (userId: string | null | undefined) => `anton:opportunities-opened:${userId || 'anon'}`;

/** The map read back from storage, keeping only what is an id with a time; a broken or missing value is an empty map. */
export function parseOpened(raw: string | null | undefined): Record<string, number> {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([id, at]) => id && typeof at === 'number' && Number.isFinite(at)).map(([id, at]) => [id, at as number]));
  } catch { return {}; }
}

/** The map with this one opened now; only the most recent `OPENED_LIMIT` are kept. */
export function markOpened(opened: Record<string, number>, id: string, now = Date.now()): Record<string, number> {
  const next = { ...opened, [id]: now };
  const entries = Object.entries(next);
  return entries.length <= OPENED_LIMIT ? next : Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, OPENED_LIMIT));
}
