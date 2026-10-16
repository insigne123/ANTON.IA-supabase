// What the team does on top of a report: items done, highlighted or with a note; the route to submit as a path of steps;
// and the dates as calendar reminders. Pure and isomorphic: the page, the API and the exports share it.
import { z } from 'zod';
import type { OpportunityReport } from './expedient';

export const MARK_KINDS = { requirement: 'req', task: 'task', step: 'step', date: 'date', risk: 'risk', question: 'ask', route: 'route' } as const;
export type MarkKind = keyof typeof MARK_KINDS;

const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
/** FNV-1a over UTF-16 code units, twice with different seeds: 16 hex characters, the same in the browser and the server. */
function hash64(text: string) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
/** An item's key: its kind and its own text, so a new version of the report keeps the marks of the items that remain. */
export const reportItemKey = (kind: MarkKind, text: string) => `${MARK_KINDS[kind]}:${hash64(normalize(text))}`;

export const markKeySchema = z.string().regex(/^[a-z]{2,12}:[a-f0-9]{16}$/);
export const markInputSchema = z.object({
  key: markKeySchema, label: z.string().trim().min(1).max(300),
  done: z.boolean().optional(), highlight: z.boolean().optional(), note: z.string().max(2000).optional(),
}).strict().refine(input => input.done !== undefined || input.highlight !== undefined || input.note !== undefined, 'Nada que guardar.');
export type ReportMark = { key: string; done: boolean; highlight: boolean; note: string; updatedBy?: string | null; updatedAt?: string | null };
export type ReportMarks = Record<string, ReportMark>;
export const emptyMark = (key: string): ReportMark => ({ key, done: false, highlight: false, note: '' });

/** The rows of opportunity_report_marks as a map by key. */
export function marksFromRows(rows: Array<{ item_key: string; done: boolean; highlight: boolean; note: string; updated_by?: string | null; updated_at?: string | null }> | null | undefined): ReportMarks {
  return Object.fromEntries((rows || []).map(row => [row.item_key, { key: row.item_key, done: row.done, highlight: row.highlight, note: row.note || '', updatedBy: row.updated_by ?? null, updatedAt: row.updated_at ?? null }]));
}

/** What can be ticked: the next steps, the requirements and the plan, each once. */
export function reportChecklist(report: Pick<OpportunityReport, 'requirements' | 'tasks'> & { nextSteps?: string[] }, steps: string[]) {
  const items = [
    ...steps.map(text => ({ key: reportItemKey('step', text), label: text })),
    ...report.requirements.map(r => ({ key: reportItemKey('requirement', r.title), label: r.title })),
    ...report.tasks.map(t => ({ key: reportItemKey('task', t.title), label: t.title })),
  ];
  return [...new Map(items.map(item => [item.key, item])).values()];
}
export function reportProgress(checklist: Array<{ key: string }>, marks: ReportMarks) {
  const done = checklist.filter(item => marks[item.key]?.done).length;
  return { done, total: checklist.length, percent: checklist.length ? Math.round((done / checklist.length) * 100) : 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Dates. The report writes them as the documents do: «29-10-2026 9:00:00», «29/10/2026», «29 de octubre de 2026, 15:00»
// or ISO. Times are Chile's; a date without time is taken at 09:00.
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** The UTC offset of Chile on that day (−03:00 in summer time, −04:00 otherwise), from the platform's time zone data. */
function chileOffsetMinutes(year: number, month: number, day: number) {
  const probe = new Date(Date.UTC(year, month - 1, day, 15));
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
    .formatToParts(probe).map(part => [part.type, part.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((local - probe.getTime()) / 60_000);
}
const chileTime = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute) - chileOffsetMinutes(year, month, day) * 60_000);

/** A date written in a report, as an instant; null when there is no full date (a «por confirmar», a relative date). */
export function parseReportDate(text: string): { at: Date; hasTime: boolean } | null {
  const value = text.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) return { at: new Date(value), hasTime: true };
  let year: number, month: number, day: number;
  const numeric = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  const words = value.toLocaleLowerCase('es').match(/(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de|\s+del)?\s+(\d{4})/);
  if (numeric) [day, month, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (words && MONTHS.includes(words[2])) [day, month, year] = [Number(words[1]), MONTHS.indexOf(words[2]) + 1, Number(words[3])];
  else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const time = value.slice((numeric || iso || words)!.index! + (numeric || iso || words)![0].length).match(/(\d{1,2}):(\d{2})/);
  const [hour, minute] = time ? [Number(time[1]), Number(time[2])] : [9, 0];
  if (hour > 23 || minute > 59) return null;
  const at = chileTime(year, month, day, hour, minute);
  return Number.isFinite(at.getTime()) ? { at, hasTime: Boolean(time) } : null;
}

export const REMINDER_OPTIONS = [
  { id: 'same', label: 'El mismo día', minutes: 0 },
  { id: '1d', label: '1 día antes', minutes: 24 * 60 },
  { id: '3d', label: '3 días antes', minutes: 3 * 24 * 60 },
  { id: '7d', label: 'Una semana antes', minutes: 7 * 24 * 60 },
] as const;
export type ReminderId = typeof REMINDER_OPTIONS[number]['id'];
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * A Google Calendar event the person adds with one click. Google's link cannot carry an alert, so the event sits at the
 * moment of the reminder the person chose («3 días antes»), half an hour long, and says which date it announces.
 */
export function googleCalendarUrl(input: { title: string; label: string; date: string; at: Date; reminder: ReminderId; details?: string }) {
  const option = REMINDER_OPTIONS.find(o => o.id === input.reminder) ?? REMINDER_OPTIONS[0];
  const start = new Date(input.at.getTime() - option.minutes * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  const text = option.minutes ? `Recordatorio: ${input.label} (${option.label.toLocaleLowerCase('es')})` : input.label;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `${text} · ${input.title}`.slice(0, 300), dates: `${stamp(start)}/${stamp(end)}`, ctz: 'America/Santiago',
    details: [`${input.label}: ${input.date}`, input.details].filter(Boolean).join('\n\n').slice(0, 1500) });
  return `https://calendar.google.com/calendar/render?${params}`;
}

const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines of at most 75 octets, continued with a space (RFC 5545). */
function fold(line: string) {
  const out: string[] = []; let current = ''; let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 73) { out.push(current); current = ' '; bytes = 1; }
    current += char; bytes += size;
  }
  return [...out, current].join('\r\n');
}
/** One calendar file with the chosen dates, each at its real time with an alert as long before as the person chose. */
export function reportCalendarFile(input: { title: string; events: Array<{ uid: string; label: string; date: string; at: Date; reminder: ReminderId; details?: string }>; now?: Date }) {
  const now = stamp(input.now ?? new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ANTON.IA//Oportunidades//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const event of input.events) {
    const option = REMINDER_OPTIONS.find(o => o.id === event.reminder) ?? REMINDER_OPTIONS[0];
    lines.push('BEGIN:VEVENT', `UID:${event.uid}@anton.ia`, `DTSTAMP:${now}`, `DTSTART:${stamp(event.at)}`, `DTEND:${stamp(new Date(event.at.getTime() + 30 * 60_000))}`,
      `SUMMARY:${icsText(`${event.label} · ${input.title}`)}`, `DESCRIPTION:${icsText([`${event.label}: ${event.date}`, event.details].filter(Boolean).join('\n\n'))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(event.label)}`, `TRIGGER:-PT${Math.max(option.minutes, 0)}M`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------------------------------------
// The route to submit: the AI's own when the report has one, or the dates and the plan in order.
export const routeStepSchema = z.object({
  title: z.string().max(120), detail: z.string().max(400), date: z.string().max(120),
  kind: z.enum(['prepare', 'ask', 'submit', 'wait', 'decide', 'contact']),
});
export const routeSchema = z.object({ steps: z.array(routeStepSchema).min(3).max(9) });
export type RouteStep = z.infer<typeof routeStepSchema> & { key: string };

/** The steps of the route, each with its key; for reports without one, the dated milestones in order and then the plan. */
export function reportRoute(report: Pick<OpportunityReport, 'milestones' | 'tasks'> & { route?: { steps: z.infer<typeof routeStepSchema>[] } | null }): RouteStep[] {
  const own = report.route?.steps?.length ? report.route.steps : null;
  if (own) return own.map(step => ({ ...step, key: reportItemKey('route', step.title) }));
  // Everything with a date goes in date order; preparation without a date goes first and a date «por confirmar» last.
  // The publication is not a step.
  const at = (date: string) => parseReportDate(date)?.at.getTime() ?? null;
  const steps = [
    ...report.tasks.slice(0, 3).map(t => ({ title: t.title.slice(0, 120), detail: [t.role, t.dependency && `Antes: ${t.dependency}`].filter(Boolean).join(' · ').slice(0, 400), date: t.due.slice(0, 120), kind: 'prepare' as const })),
    ...report.milestones.filter(m => !/publicaci[oó]n/i.test(m.label)).slice(0, 6).map(m => ({ title: m.label.slice(0, 120), detail: '', date: m.date.slice(0, 120),
      kind: /consulta|pregunta/i.test(m.label) ? 'ask' as const : /cierre|oferta|presentaci/i.test(m.label) ? 'submit' as const : /adjudic|resultado/i.test(m.label) ? 'decide' as const : 'wait' as const })),
  ].map((step, order) => ({ step, order, when: at(step.date) ?? (step.kind === 'prepare' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY) }))
    .sort((a, b) => (a.when === b.when ? 0 : a.when < b.when ? -1 : 1) || a.order - b.order).map(({ step }) => step);
  return steps.slice(0, 9).map(step => ({ ...step, key: reportItemKey('route', step.title) }));
}
