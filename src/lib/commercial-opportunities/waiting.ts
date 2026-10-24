// What waits for an answer on Oportunidades, in the words of whoever reads it: an administrator reads who asks what and since when
// («Diego pide una decisión · espera hace 3 días»), whoever asked reads how long it has waited («Pediste una decisión · esperando
// respuesta desde ayer»). «Hoy» (lib/home/opportunities-today.ts) and «Novedades» on Oportunidades say it the same way. Pure: the server
// reads the facts (server/commercial-opportunities/workspace-waiting.ts).
import { dayInZone, shiftDay } from '@/lib/admin/chile-time';
import { waitingSince } from './member-work';

export type WaitingItem = { id: string; title: string; kind: 'ask' | 'no_go' | 'blocked'; who: string; since: string; dueAt: string | null; actorId: string | null };
export type OpportunityLine = { id: string; title: string; detail: string; urgent: boolean; href: string };
export type OpportunitySection = { total: number; lines: OpportunityLine[] };

/** Rows per section: the rest is one tap away. */
export const SECTION_LINES = 3;
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const validDate = (at: string | null | undefined): at is string => Boolean(at) && Number.isFinite(Date.parse(at!));
export const opportunityHref = (id: string) => `/opportunities?op=${encodeURIComponent(id)}`;
export const cleanTitle = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, 140) || 'Oportunidad';
export const lineSection = (lines: OpportunityLine[], limit = SECTION_LINES): OpportunitySection => ({ total: lines.length, lines: lines.slice(0, limit) });

/** «hoy», «mañana», «el viernes» within the week, then «el 12 de noviembre», in Chile. */
export function dayLabel(at: string, now: Date) {
  const day = dayInZone(new Date(at)), today = dayInZone(now);
  if (day === today) return 'hoy';
  if (day === shiftDay(today, 1)) return 'mañana';
  const [year, month, date] = day.split('-').map(Number);
  if (day > today && day <= shiftDay(today, 6)) return `el ${WEEKDAYS[new Date(Date.UTC(year, month - 1, date, 12)).getUTCDay()]}`;
  return `el ${date} de ${MONTHS[month - 1]}`;
}

/** Whole days between two instants, by the calendar in Chile. */
function daysSince(at: string, now: Date) {
  return Math.round((Date.parse(`${dayInZone(now)}T12:00:00Z`) - Date.parse(`${dayInZone(new Date(at))}T12:00:00Z`)) / 86_400_000);
}

/** The date asked for, when it is close or already gone: «la piden para mañana», «la fecha pedida ya pasó». */
function askedFor(dueAt: string | null, now: Date) {
  if (!validDate(dueAt)) return null;
  const due = dayInZone(new Date(dueAt)), today = dayInZone(now);
  if (due < today) return 'la fecha pedida ya pasó';
  return due <= shiftDay(today, 1) ? `la piden para ${dayLabel(dueAt, now)}` : null;
}

/** One thing waiting, for an administrator (`admin`) or for whoever asked it. */
export function waitingLine(item: WaitingItem, now: Date, admin: boolean): OpportunityLine {
  const due = askedFor(item.dueAt, now);
  const days = daysSince(item.since, now);
  const what = item.kind === 'blocked' ? 'Bloqueada' : admin ? `${item.who} ${item.kind === 'no_go' ? 'propone no postular' : 'pide una decisión'}`
    : item.kind === 'no_go' ? 'Propusiste no postular' : 'Pediste una decisión';
  const tail = due || (admin ? (days >= 1 ? `espera ${waitingSince(item.since, now)}` : '') : `esperando respuesta ${waitingSince(item.since, now)}`);
  return { id: item.id, title: cleanTitle(item.title), detail: tail ? `${what} · ${tail}` : what, urgent: Boolean(due) || item.kind === 'blocked' || days >= 2, href: opportunityHref(item.id) };
}

/** What waits, for whoever reads it: everything for an administrator; for anyone else, the decisions they asked (a block is answered by working it). */
export function waitingFor(items: readonly WaitingItem[], admin: boolean, userId: string) {
  return admin ? [...items] : items.filter(item => item.kind !== 'blocked' && item.actorId === userId);
}
