/**
 * «Oportunidades» on «Hoy» (OPP-02, OPP-03): until now the most visited page said nothing about tenders, and whoever only works them
 * found a list of prospecting steps. This is what a person with access to Oportunidades has to act on today: what waits for an answer
 * (for an administrator, the decisions and blocks of the team; for anyone else, the decisions they asked, «Esperando respuesta hace 2
 * días»), the ones they work, the closest first, the reports ready, and for an administrator the recommended ones closing this week
 * that nobody works yet. Pure: the route reads (api/home/opportunities), this decides what to say.
 */
import { dayInZone, shiftDay } from '@/lib/admin/chile-time';
import { cleanTitle as clean, dayLabel, lineSection as section, opportunityHref as href, validDate as valid, waitingFor, waitingLine,
  type OpportunityLine, type OpportunitySection, type WaitingItem } from '@/lib/commercial-opportunities/waiting';

export type { OpportunityLine, OpportunitySection } from '@/lib/commercial-opportunities/waiting';
export type TodayOpportunity = { id: string; title: string; kind: string; deadlineAt: string | null; nextActionAt: string | null; state: string };
export type OpportunitiesTodayInput = {
  now: Date;
  admin: boolean;
  userId: string;
  /** The ones the person is part of and still in play. */
  mine: TodayOpportunity[];
  /** Reports (or drafts of the offer, `offer`) ready on one of theirs, not read yet. */
  reports: Array<{ id: string; title: string; offer?: boolean }>;
  /** What waits for the administrators (server/commercial-opportunities/workspace-waiting.ts). */
  waiting: WaitingItem[];
  /** Recommended, closing within a week, and nobody works them. Only read for an administrator. */
  closingWithoutTeam: Array<{ id: string; title: string; deadlineAt: string }>;
};
export type OpportunitiesToday = {
  admin: boolean;
  waiting: OpportunitySection;
  mine: OpportunitySection;
  reports: OpportunitySection;
  closing: OpportunitySection & { href: string };
  /** Nothing to show: the card stays out of «Hoy». */
  empty: boolean;
};

/** The recommended ones by closing date, the soonest first (lib/commercial-opportunities/workspace-url.ts). */
export const CLOSING_THIS_WEEK_HREF = '/opportunities?vista=lista&orden=deadline';

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

export function opportunitiesToday(input: OpportunitiesTodayInput): OpportunitiesToday {
  const { now, admin } = input;
  const asked = waitingFor(input.waiting, admin, input.userId);
  const waiting = section(asked.map(item => waitingLine(item, now, admin)));
  // An opportunity already in «waiting» is said there once.
  const said = new Set(asked.map(item => item.id));
  const mine = section([...input.mine].filter(item => !said.has(item.id)).map(item => ({ item, due: dueOf(item, now) }))
    .sort((a, b) => a.due[0] - b.due[0] || a.due[1] - b.due[1] || a.item.title.localeCompare(b.item.title, 'es'))
    .map(({ item }) => mineLine(item, now)));
  const reports = section(input.reports.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
    .map(item => ({ id: item.id, title: clean(item.title), detail: item.offer ? 'El borrador de oferta está listo' : 'El informe está listo', urgent: false, href: href(item.id) })));
  const closing = section(admin ? [...input.closingWithoutTeam].filter(item => valid(item.deadlineAt)).sort((a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt))
    .map(item => ({ id: item.id, title: clean(item.title), detail: `Cierra ${dayLabel(item.deadlineAt, now)} · sin equipo`, urgent: dayInZone(new Date(item.deadlineAt)) <= shiftDay(dayInZone(now), 2), href: href(item.id) })) : []);
  return {
    admin, waiting, mine, reports, closing: { ...closing, href: CLOSING_THIS_WEEK_HREF },
    empty: !waiting.total && !mine.total && !reports.total && !closing.total,
  };
}
