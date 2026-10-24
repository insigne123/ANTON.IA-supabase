/**
 * «Oportunidades» on «Hoy» (OPP-02, OPP-03): until now the most visited page said nothing about tenders, and whoever only works them
 * found a list of prospecting steps. This is what a person with access to Oportunidades has to act on today: what waits for an answer
 * (for an administrator, the decisions and blocks of the team; for anyone else, the decisions they asked, «Esperando respuesta hace 2
 * días»), the ones they work, the closest first, the reports ready, and for an administrator the recommended ones closing this week
 * that nobody works yet. Pure: the route reads (api/home/opportunities), this decides what to say.
 */
import { dayInZone, shiftDay } from '@/lib/admin/chile-time';
import type { WaitingItem } from '@/lib/server/commercial-opportunities/workspace-waiting';

export type TodayOpportunity = { id: string; title: string; kind: string; deadlineAt: string | null; nextActionAt: string | null; state: string };
export type OpportunitiesTodayInput = {
  now: Date;
  admin: boolean;
  userId: string;
  /** The ones the person is part of and still in play. */
  mine: TodayOpportunity[];
  /** Reports ready on one of theirs, not read yet. */
  reports: Array<{ id: string; title: string }>;
  /** What waits for the administrators (server/commercial-opportunities/workspace-waiting.ts). */
  waiting: WaitingItem[];
  /** Recommended, closing within a week, and nobody works them. Only read for an administrator. */
  closingWithoutTeam: Array<{ id: string; title: string; deadlineAt: string }>;
};
export type OpportunityLine = { id: string; title: string; detail: string; urgent: boolean; href: string };
export type OpportunitySection = { total: number; lines: OpportunityLine[] };
export type OpportunitiesToday = {
  admin: boolean;
  waiting: OpportunitySection;
  mine: OpportunitySection;
  reports: OpportunitySection;
  closing: OpportunitySection & { href: string };
  /** Nothing to show: the card stays out of «Hoy». */
  empty: boolean;
};

/** Rows per section: the rest is one tap away, in Oportunidades. */
export const TODAY_LINES = 3;
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** The recommended ones by closing date, the soonest first (lib/commercial-opportunities/workspace-url.ts). */
export const CLOSING_THIS_WEEK_HREF = '/opportunities?vista=lista&orden=deadline';

const valid = (at: string | null | undefined): at is string => Boolean(at) && Number.isFinite(Date.parse(at!));
const href = (id: string) => `/opportunities?op=${encodeURIComponent(id)}`;
const clean = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, 140) || 'Oportunidad';

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
  const from = Date.parse(`${dayInZone(new Date(at))}T12:00:00Z`), to = Date.parse(`${dayInZone(now)}T12:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** «hace 3 días», «desde ayer», «desde hoy». */
function waitedFor(at: string, now: Date) {
  const days = daysSince(at, now);
  return days <= 0 ? 'desde hoy' : days === 1 ? 'desde ayer' : `hace ${days} días`;
}

/** The date asked for, when it is close or already gone: «la piden para mañana», «la fecha pedida ya pasó». */
function askedFor(dueAt: string | null, now: Date) {
  if (!valid(dueAt)) return null;
  const due = dayInZone(new Date(dueAt)), today = dayInZone(now);
  if (due < today) return 'la fecha pedida ya pasó';
  return due <= shiftDay(today, 1) ? `la piden para ${dayLabel(dueAt, now)}` : null;
}

/** An administrator reads who asks what; whoever asked reads how long it has waited («Esperando respuesta hace 2 días»). */
function waitingLine(item: WaitingItem, now: Date, admin: boolean): OpportunityLine {
  const due = askedFor(item.dueAt, now);
  const days = daysSince(item.since, now);
  const what = item.kind === 'blocked' ? 'Bloqueada' : admin ? `${item.who} ${item.kind === 'no_go' ? 'propone no postular' : 'pide una decisión'}`
    : item.kind === 'no_go' ? 'Propusiste no postular' : 'Pediste una decisión';
  const tail = due || (admin ? (days >= 1 ? `espera ${waitedFor(item.since, now)}` : '') : `esperando respuesta ${waitedFor(item.since, now)}`);
  return { id: item.id, title: clean(item.title), detail: tail ? `${what} · ${tail}` : what, urgent: Boolean(due) || item.kind === 'blocked' || days >= 2, href: href(item.id) };
}

/** What comes first on one of theirs: the closing date, the next action when it is due, or that it is blocked. */
function mineLine(item: TodayOpportunity, now: Date): OpportunityLine {
  const today = dayInZone(now);
  const parts: string[] = [];
  let urgent = false;
  if (item.state === 'blocked') { parts.push('Bloqueada'); urgent = true; }
  if (valid(item.deadlineAt)) {
    const closes = dayInZone(new Date(item.deadlineAt));
    // Nothing left to rescue, so not urgent: it is there to be marked as presented or closed.
    if (closes < today || Date.parse(item.deadlineAt) < now.getTime()) parts.push('El plazo de cierre ya pasó');
    else { parts.push(`Cierra ${dayLabel(item.deadlineAt, now)}`); urgent ||= closes <= shiftDay(today, 2); }
  }
  if (valid(item.nextActionAt) && dayInZone(new Date(item.nextActionAt)) <= today) {
    parts.push(dayInZone(new Date(item.nextActionAt)) < today ? 'Próxima acción atrasada' : 'Próxima acción hoy');
    urgent = true;
  }
  if (!parts.length) parts.push(item.state === 'assigned' ? 'Asignada, sin empezar' : 'En preparación');
  return { id: item.id, title: clean(item.title), detail: parts.slice(0, 2).join(' · '), urgent, href: href(item.id) };
}

/** The order: what can still be done, by its closing date or next action (an overdue one first), then what already closed. */
function dueOf(item: TodayOpportunity, now: Date): [number, number] {
  const closed = valid(item.deadlineAt) && Date.parse(item.deadlineAt) < now.getTime();
  const dates = [closed ? null : item.deadlineAt, item.nextActionAt].filter(valid).map(Date.parse);
  return [closed ? 1 : 0, dates.length ? Math.min(...dates) : Number.POSITIVE_INFINITY];
}

const section = (lines: OpportunityLine[]): OpportunitySection => ({ total: lines.length, lines: lines.slice(0, TODAY_LINES) });

export function opportunitiesToday(input: OpportunitiesTodayInput): OpportunitiesToday {
  const { now, admin } = input;
  // For an administrator, everything that waits for them; for anyone else, the decisions they asked (a block is answered by working it).
  const waitingFor = admin ? input.waiting : input.waiting.filter(item => item.kind !== 'blocked' && item.actorId === input.userId);
  const waiting = section(waitingFor.map(item => waitingLine(item, now, admin)));
  // An opportunity already in «waiting» is said there once.
  const said = new Set(waiting.lines.map(line => line.id));
  const mine = section([...input.mine].filter(item => !said.has(item.id)).map(item => ({ item, due: dueOf(item, now) }))
    .sort((a, b) => a.due[0] - b.due[0] || a.due[1] - b.due[1] || a.item.title.localeCompare(b.item.title, 'es'))
    .map(({ item }) => mineLine(item, now)));
  const reports = section(input.reports.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
    .map(item => ({ id: item.id, title: clean(item.title), detail: 'El informe está listo', urgent: false, href: href(item.id) })));
  const closing = section(admin ? [...input.closingWithoutTeam].filter(item => valid(item.deadlineAt)).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt))
    .map(item => ({ id: item.id, title: clean(item.title), detail: `Cierra ${dayLabel(item.deadlineAt, now)} · sin equipo`, urgent: dayInZone(new Date(item.deadlineAt)) <= shiftDay(dayInZone(now), 2), href: href(item.id) })) : []);
  return {
    admin, waiting, mine, reports, closing: { ...closing, href: CLOSING_THIS_WEEK_HREF },
    empty: !waiting.total && !mine.total && !reports.total && !closing.total,
  };
}
