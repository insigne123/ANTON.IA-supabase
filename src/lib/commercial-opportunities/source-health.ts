// How each source of the daily search went (OPP-15): before, the strip only said «Búsqueda diaria programada», and a radar with
// nothing new looked the same as a broken one (in a month 19 of 70 tender searches failed, 9 with «Compra Ágil respondió 504», and 4 of
// 10 LinkedIn ones). Read from the search jobs of the last days, per source and day in Chile. Pure: the server reads the jobs
// (server/commercial-opportunities/workspace-source-health.ts), the strip and the morning alert say it.
import { dayInZone, shiftDay } from '@/lib/admin/chile-time';
import type { SearchSource } from './search-settings';

const SHORT_LABELS: Record<SearchSource, string> = { tenders: 'Licitaciones', compraAgil: 'Compra Ágil', posts: 'LinkedIn', hiring: 'Avisos de trabajo' };
export type SourceRun = { source: SearchSource; state: string; error: string | null; createdAt: string; updatedAt: string };
export type SourceState = 'ok' | 'partial' | 'searching' | 'retrying' | 'failed';
export type SourceHealth = { source: SearchSource; label: string; state: SourceState; at: string | null; detail: string; failingDays: number };

const RUNNING = ['queued', 'running'];
const FAILED = ['failed', 'blocked'];

/** What a person reads of a failure: the job's own error is for the record. */
export function friendlySourceError(error: string | null | undefined) {
  const text = String(error || '');
  if (/ticket/i.test(text)) return 'Falta conectar el ticket de Mercado Público';
  if (/presupuesto/i.test(text)) return 'Se alcanzó el presupuesto de búsqueda del mes';
  if (/LinkedIn no está conectado/i.test(text)) return 'LinkedIn no está conectado';
  if (/criterios cambiaron/i.test(text)) return 'Los criterios cambiaron; buscamos de nuevo con los nuevos';
  if (/\b5\d\d\b|no respondi|timeout|tiempo de espera/i.test(text)) return 'Mercado Público no respondió';
  return 'La búsqueda no terminó';
}

const hourOf = (at: string) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
/** «hoy 08:06», «ayer 08:05», «el 21 de octubre». */
export function whenLabel(at: string, now: Date) {
  const day = dayInZone(new Date(at)), today = dayInZone(now);
  if (day === today) return `hoy ${hourOf(at)}`;
  if (day === shiftDay(today, -1)) return `ayer ${hourOf(at)}`;
  return `el ${new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long' }).format(new Date(at))}`;
}

/** How a day of one source ended: still searching, retrying, all of it failed, part of it, or fine. */
function dayOutcome(runs: SourceRun[]): { state: SourceState; ok: number; total: number; error: string | null } {
  const ok = runs.filter(run => run.state === 'ready').length;
  const failed = runs.filter(run => FAILED.includes(run.state));
  const state: SourceState = runs.some(run => RUNNING.includes(run.state)) ? 'searching' : runs.some(run => run.state === 'waiting') ? 'retrying'
    : failed.length && !ok ? 'failed' : failed.length ? 'partial' : 'ok';
  return { state, ok, total: runs.length, error: failed[0]?.error ?? null };
}

/**
 * Per source, from its runs of the last days (any order): how its latest day went, when it last answered, and for how many days in a
 * row it has failed. A source with no runs is left out: it is not part of this search.
 */
export function sourceHealth(runs: SourceRun[], now: Date): SourceHealth[] {
  const sources = [...new Set(runs.map(run => run.source))];
  const order: SearchSource[] = ['tenders', 'compraAgil', 'posts', 'hiring'];
  return order.filter(source => sources.includes(source)).map(source => {
    const mine = runs.filter(run => run.source === source);
    const days = [...new Set(mine.map(run => dayInZone(new Date(run.createdAt))))].sort().reverse();
    const outcomes = days.map(day => dayOutcome(mine.filter(run => dayInZone(new Date(run.createdAt)) === day)));
    const latest = outcomes[0];
    let failingDays = 0;
    for (const outcome of outcomes) { if (outcome.state !== 'failed') break; failingDays++; }
    const answered = mine.filter(run => run.state === 'ready').map(run => run.updatedAt).sort().at(-1) ?? null;
    const detail = latest.state === 'ok' ? `Respondió ${answered ? whenLabel(answered, now) : 'hoy'}`
      : latest.state === 'searching' ? 'Buscando ahora'
      : latest.state === 'retrying' ? 'No respondió a la primera; reintentamos solos'
      : latest.state === 'partial' ? `${latest.ok} de ${latest.total} búsquedas respondieron; las demás se reintentan mañana`
      : `${friendlySourceError(latest.error)}${failingDays >= 2 ? ` · ${failingDays} días seguidos` : ''}`;
    return { source, label: SHORT_LABELS[source], state: latest.state, at: answered, detail, failingDays };
  });
}

/** The sources that failed two days in a row or more: the morning alert tells whoever manages Oportunidades. */
export const failingSources = (health: readonly SourceHealth[]) => health.filter(item => item.failingDays >= 2);

/** «Última búsqueda: hoy 08:06», from the last answer of any source; null before any. */
export function lastSearchLabel(health: readonly SourceHealth[], now: Date) {
  const last = health.map(item => item.at).filter((at): at is string => Boolean(at)).sort().at(-1);
  return last ? `Última búsqueda: ${whenLabel(last, now)}` : null;
}
