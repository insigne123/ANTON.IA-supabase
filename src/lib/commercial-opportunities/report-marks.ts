// What the team does on top of a report: items done, highlighted or with a note; the route to submit as a path of steps;
// and the dates as calendar reminders. Pure and isomorphic: the page, the API and the exports share it.
import { z } from 'zod';
import type { OpportunityReport } from './expedient';

export const MARK_KINDS = { requirement: 'req', task: 'task', step: 'step', date: 'date', risk: 'risk', question: 'ask', route: 'route', document: 'doc' } as const;
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
/** That day and time on Chile's clock, as an instant (work-tasks.ts stores a task's day with it). */
export const chileTime = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute) - chileOffsetMinutes(year, month, day) * 60_000);

/** A date written in a report, as an instant; null when there is no full date (a «por confirmar», a relative date). */
/**
 * A milestone's date, or null when the report wrote that there is none («Sin fecha informada», «Sin información», «Por definir»):
 * those read as dates in the list, the route and the e-mail to the buyer. 2 of the last 8 reports had one.
 */
export function milestoneDate(value: string | null | undefined): string | null {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text || /^[-—–.\s]+$/.test(text)) return null;
  return /^(sin|no)\b.{0,40}\b(fecha|informaci|informad|publicad|indica|defin|precis|especific)|^(por (definir|confirmar|informar)|pendiente|n\/?a|desconocid[ao])\b/i.test(text) ? null : text;
}
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

/** What a reminder is about: enough for the person to know which opportunity it speaks of, from the calendar alone. */
export type ReminderSubject = {
  title: string; buyer?: string | null; code?: string | null; kind?: string | null;
  /** Where to open it in ANTON.IA, and the official page of the purchase. */
  appUrl?: string | null; sourceUrl?: string | null;
};
const SUBJECT_NAME: Record<string, string> = { tender: 'Licitación', compra_agil: 'Compra Ágil', private: 'Compra privada', project: 'Proyecto' };
const WHEN: Record<ReminderId, string> = { same: 'Hoy', '1d': 'Mañana', '3d': 'En 3 días', '7d': 'En una semana' };

/** «Cierre de recepción de ofertas · Servicio de aseo del Museo (ID 1217466-29-LP26)»: the date, then which purchase. */
export function reminderSummary(label: string, subject: ReminderSubject) {
  const name = subject.title.trim();
  return `${label}${name ? ` · ${name}` : ''}${subject.code ? ` (ID ${subject.code})` : ''}`;
}
/** The title of the event at the moment of the reminder: when it is, the date it announces and the purchase. */
export function reminderTitle(label: string, reminder: ReminderId, subject: ReminderSubject) {
  return `${WHEN[reminder]}: ${reminderSummary(label, subject)}`;
}
/** The description: the date in full, which purchase and who buys it, and the links to open it. */
export function reminderDetails(input: { label: string; date: string; subject: ReminderSubject; details?: string }) {
  const { subject } = input;
  const kind = SUBJECT_NAME[subject.kind || ''] || 'Oportunidad';
  return [
    `${input.label}: ${input.date}`,
    [subject.title ? `${kind}: ${subject.title}` : '', subject.buyer ? `Organismo: ${subject.buyer}` : '', subject.code ? `ID: ${subject.code}` : ''].filter(Boolean).join('\n'),
    input.details || '',
    [subject.appUrl ? `Abrir en ANTON.IA: ${subject.appUrl}` : '', subject.sourceUrl ? `Ficha oficial: ${subject.sourceUrl}` : ''].filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n\n');
}

type CalendarEvent = { subject: ReminderSubject; label: string; date: string; at: Date; reminder: ReminderId; details?: string };
/**
 * What a calendar link carries, the same for every calendar: neither link can carry an alert, so the event sits at the moment of the
 * reminder the person chose («en 3 días»), half an hour long, and says which date it announces and which purchase.
 */
function calendarSlot(input: CalendarEvent) {
  const option = REMINDER_OPTIONS.find(o => o.id === input.reminder) ?? REMINDER_OPTIONS[0];
  const start = new Date(input.at.getTime() - option.minutes * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  const title = (option.minutes ? reminderTitle(input.label, input.reminder, input.subject) : reminderSummary(input.label, input.subject)).slice(0, 300);
  const details = reminderDetails({ label: input.label, date: input.date, subject: input.subject, details: input.details }).slice(0, 1800);
  const location = input.subject.sourceUrl && /^https?:\/\//.test(input.subject.sourceUrl) ? input.subject.sourceUrl.slice(0, 300) : null;
  return { start, end, title, details, location };
}

/** A Google Calendar event the person adds with one click. */
export function googleCalendarUrl(input: CalendarEvent) {
  const { start, end, title, details, location } = calendarSlot(input);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(start)}/${stamp(end)}`, ctz: 'America/Santiago', details });
  if (location) params.set('location', location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/**
 * The same event for Outlook on the web with a work or school account (Microsoft 365), where a company's calendar lives. It opens the
 * new-event form filled in, in the person's own calendar; nothing is read or written for them. Dates go in UTC, which Outlook shows in
 * the person's time zone.
 */
export function outlookCalendarUrl(input: CalendarEvent) {
  const { start, end, title, details, location } = calendarSlot(input);
  const utc = (date: Date) => `${date.toISOString().slice(0, 19)}+00:00`;
  const params = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: utc(start), enddt: utc(end), body: details.replace(/\n/g, '\r\n') });
  if (location) params.set('location', location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params}`;
}

/** Where a reminder can be added with one click: the work calendar first (Microsoft 365), then Google's. */
export const CALENDAR_PROVIDERS = [{ id: 'outlook', label: 'Outlook (Microsoft 365)', short: 'Outlook' }, { id: 'google', label: 'Google Calendar', short: 'Google' }] as const;
export type CalendarProvider = typeof CALENDAR_PROVIDERS[number]['id'];
export const isCalendarProvider = (value: unknown): value is CalendarProvider => CALENDAR_PROVIDERS.some(provider => provider.id === value);
export const calendarUrl = (provider: CalendarProvider, input: CalendarEvent) => (provider === 'google' ? googleCalendarUrl(input) : outlookCalendarUrl(input));

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
export function reportCalendarFile(input: { subject: ReminderSubject; events: Array<{ uid: string; label: string; date: string; at: Date; reminder: ReminderId; details?: string }>; now?: Date }) {
  const now = stamp(input.now ?? new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ANTON.IA//Oportunidades//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const event of input.events) {
    const option = REMINDER_OPTIONS.find(o => o.id === event.reminder) ?? REMINDER_OPTIONS[0];
    lines.push('BEGIN:VEVENT', `UID:${event.uid}@anton.ia`, `DTSTAMP:${now}`, `DTSTART:${stamp(event.at)}`, `DTEND:${stamp(new Date(event.at.getTime() + 30 * 60_000))}`,
      `SUMMARY:${icsText(reminderSummary(event.label, input.subject))}`, `DESCRIPTION:${icsText(reminderDetails({ label: event.label, date: event.date, subject: input.subject, details: event.details }))}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(reminderSummary(event.label, input.subject))}`, `TRIGGER:-PT${Math.max(option.minutes, 0)}M`, 'END:VALARM', 'END:VEVENT');
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
    ...report.milestones.filter(m => !/publicaci[oó]n/i.test(m.label)).slice(0, 6).map(m => ({ title: m.label.slice(0, 120), detail: '', date: (milestoneDate(m.date) ?? '').slice(0, 120),
      kind: /consulta|pregunta/i.test(m.label) ? 'ask' as const : /cierre|oferta|presentaci/i.test(m.label) ? 'submit' as const : /adjudic|resultado/i.test(m.label) ? 'decide' as const : 'wait' as const })),
  ].map((step, order) => ({ step, order, when: at(step.date) ?? (step.kind === 'prepare' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY) }))
    .sort((a, b) => (a.when === b.when ? 0 : a.when < b.when ? -1 : 1) || a.order - b.order).map(({ step }) => step);
  return steps.slice(0, 9).map(step => ({ ...step, key: reportItemKey('route', step.title) }));
}
