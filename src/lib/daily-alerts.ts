import { dayInZone, shiftDay } from '@/lib/admin/chile-time';
import { emailShell } from '@/lib/email-shell';
import { dropEmailSection, dropHref, dropSubject, type DropItem } from '@/lib/lead-drops';
import { goalNextStep, goalPace, goalsOff, progressText, type GoalProgress } from '@/lib/weekly-goals';

/**
 * «Avisos» (idea 3): one email in the morning, from Tuesday to Friday, only when there is something concrete to do. It
 * names it: «Te respondió Juan Pérez», «2 licitaciones que te sirven cierran el viernes», «Los 12 contactos que guardaste
 * ayer ya tienen correo». A goal that is behind is reason enough on Wednesdays and Fridays; any other day it only rides along.
 * On Tuesdays, Wednesdays and Fridays it also brings «Contacto del día» (src/lib/lead-drops.ts): one email a day, never two.
 * Mondays belong to the weekly report. Pure: the server reads the facts (server/daily-alerts.ts).
 */

export type AlertPerson = { id: string; name: string; company: string | null };
export type AlertOpportunity = { id: string; kind: string; title: string; deadlineAt: string; recommended: boolean; mine: boolean };
export type AlertFacts = {
  name: string;
  /** Replied since the last alert and still waiting for an answer, the oldest first. */
  newReplies: AlertPerson[];
  /** Still waiting for an answer, from before the last alert. */
  olderPending: number;
  /** Open commitments due today or already overdue. */
  commitments: Array<AlertPerson & { title: string; dueAt: string }>;
  /** Contacts that got an email since the last alert and nobody wrote to yet; `yesterday` when all of them are from yesterday. */
  newReady: { count: number; yesterday: boolean };
  /** All the contacts ready to write, for the goal's next step. */
  ready: number;
  /** Research that finished since the last alert: the contact (enriched lead) and a name to say. */
  research: Array<{ leadId: string | null; name: string }>;
  /** Opportunities of the person, or recommended and nobody's when they manage them, closing within three days. */
  closing: AlertOpportunity[];
  goal: GoalProgress | null;
  /** Today's «Contacto del día», when it is ready. */
  drop?: { id: string; items: DropItem[] } | null;
};
export type AlertKind = 'reply' | 'pending' | 'commitment' | 'closing' | 'drop' | 'research' | 'ready' | 'goal';
export type AlertLine = { kind: AlertKind; text: string; href: string };
export type DailyAlert = { subject: string; lines: AlertLine[] };

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const weekdayOf = (day: string) => new Date(`${day}T12:00:00.000Z`).getUTCDay();
const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;
const who = (person: AlertPerson) => `${person.name}${person.company ? ` (${person.company})` : ''}`;

/** Tuesday to Friday: Monday has the weekly report and the weekend has nobody to answer. */
export const alertDay = (now: Date) => { const weekday = weekdayOf(dayInZone(now)); return weekday >= 2 && weekday <= 5; };
/** Wednesday and Friday: the days a goal that is behind is worth an email on its own. */
const goalDay = (now: Date) => [3, 5].includes(weekdayOf(dayInZone(now)));

/** «hoy», «mañana», «el viernes», relative to today in Chile. */
export function dayWord(at: string, now: Date) {
  const day = dayInZone(new Date(at)), today = dayInZone(now);
  if (day === today) return 'hoy';
  if (day === shiftDay(today, 1)) return 'mañana';
  return `el ${WEEKDAYS[weekdayOf(day)]}`;
}

const KIND_WORDS: Record<string, [string, string]> = { tender: ['licitación', 'licitaciones'], compra_agil: ['compra ágil', 'compras ágiles'] };

/** «2 licitaciones que te sirven cierran el viernes», «Una oportunidad a tu cargo cierra mañana». */
export function closingText(items: AlertOpportunity[], now: Date) {
  const kinds = new Set(items.map(item => item.kind));
  const [one, many] = kinds.size === 1 ? KIND_WORDS[items[0].kind] || ['oportunidad', 'oportunidades'] : ['oportunidad', 'oportunidades'];
  const qualifier = items.every(item => item.mine) ? ' a tu cargo' : items.every(item => item.recommended) ? ' que te sirven' : '';
  const days = [...new Set(items.map(item => dayWord(item.deadlineAt, now)))];
  const when = days.length === 1 ? days[0] : 'en los próximos días';
  if (items.length === 1) {
    const singular = qualifier === ' que te sirven' ? ' que te sirve' : qualifier;
    return `Una ${one}${singular} cierra ${when}: ${items[0].title}`;
  }
  return `${items.length.toLocaleString('es-CL')} ${many}${qualifier} cierran ${when}`;
}

/**
 * The morning alert, or null when there is nothing concrete to do. The subject names the most urgent thing; the body lists
 * each thing once with its link, then the goal. `goalReminders: false` keeps a goal that is behind from being the reason
 * on its own (for whoever belongs to several workspaces, it is one of them).
 */
export function composeAlert(facts: AlertFacts, now: Date, options: { goalReminders?: boolean } = {}): DailyAlert | null {
  const goal = facts.goal && !goalsOff(facts.goal.targets) ? facts.goal : null;
  const goalBehind = goal ? goalPace(goal, now).behind : false;
  const lines: AlertLine[] = [];
  let subject = '';
  const lead = (text: string) => { if (!subject) subject = text; };

  const replies = facts.newReplies;
  if (replies.length) {
    lead(replies.length === 1 ? `Te respondió ${replies[0].name}` : replies.length === 2 ? `Te respondieron ${replies[0].name} y ${replies[1].name}`
      : `Te respondieron ${replies[0].name} y ${replies.length - 1} personas más`);
    for (const person of replies.slice(0, 3)) lines.push({ kind: 'reply', text: `${who(person)} te respondió`, href: `/contacted?c=${encodeURIComponent(person.id)}` });
    if (replies.length > 3) lines.push({ kind: 'reply', text: `Y ${plural(replies.length - 3, 'respuesta más', 'respuestas más')}`, href: '/contacted/replied' });
  }

  for (const item of facts.commitments.slice(0, 2)) {
    const overdue = dayInZone(new Date(item.dueAt)) < dayInZone(now);
    const text = `${overdue ? 'Vencido' : 'Hoy'}: ${item.title} con ${who(item)}`;
    lead(text);
    lines.push({ kind: 'commitment', text, href: `/contacted?c=${encodeURIComponent(item.id)}` });
  }
  if (facts.commitments.length > 2) lines.push({ kind: 'commitment', text: `Y ${plural(facts.commitments.length - 2, 'compromiso más', 'compromisos más')}`, href: '/contacted' });

  if (facts.closing.length) {
    const text = closingText(facts.closing, now);
    lead(facts.closing.length === 1 ? text.split(':')[0] : text);
    lines.push({ kind: 'closing', text, href: facts.closing.length === 1 ? `/opportunities?op=${encodeURIComponent(facts.closing[0].id)}` : '/opportunities' });
  }

  if (facts.drop?.items.length) {
    const count = facts.drop.items.length;
    lead(dropSubject(facts.drop.items));
    lines.push({ kind: 'drop', text: count === 1 ? 'Tu contacto de hoy, con su correo listo: guárdalo sin gastar créditos'
      : `${count} contactos nuevos para ti, con su correo listo: guárdalos sin gastar créditos`, href: dropHref(facts.drop.id) });
  }

  if (facts.research.length) {
    const [first] = facts.research;
    const text = facts.research.length === 1 ? `Lista la investigación de ${first.name}` : `Listas ${facts.research.length} investigaciones: ${facts.research.slice(0, 3).map(item => item.name).join(', ')}${facts.research.length > 3 ? '…' : ''}`;
    lead(text);
    lines.push({ kind: 'research', text, href: facts.research.length === 1 && first.leadId ? `/saved/leads/enriched?investigar=${encodeURIComponent(first.leadId)}` : '/saved/leads/enriched' });
  }

  if (facts.newReady.count) {
    // «Los que guardaste», not «tus contactos»: on a day with a «Contacto del día» the email would otherwise count two sets
    // of contacts in the same words, and whoever reads «Tus 3 contactos» next to «Tu contacto de hoy» looks for three.
    const { count, yesterday } = facts.newReady;
    const saved = `que guardaste${yesterday ? ' ayer' : ''}`;
    const text = count === 1 ? `El contacto ${saved} ya tiene correo` : `Los ${count.toLocaleString('es-CL')} contactos ${saved} ya tienen correo`;
    lead(text);
    lines.push({ kind: 'ready', text: `${text}: escríbe${count === 1 ? 'le' : 'les'} desde «Por escribir»`, href: '/saved/leads/enriched' });
  }

  const remindGoal = Boolean(options.goalReminders !== false && goal && goalBehind && goalDay(now));
  if (!lines.length && !remindGoal) return null;

  if (facts.olderPending && lines.length) lines.push({ kind: 'pending', text: `${facts.olderPending === 1 ? 'Te espera 1 respuesta' : `Te esperan ${facts.olderPending.toLocaleString('es-CL')} respuestas`} de días anteriores`, href: '/contacted/replied' });

  if (goal) {
    const step = goalNextStep(goal, facts.ready);
    if (remindGoal) lead(`Vas ${goal.counts.contacted.toLocaleString('es-CL')} de ${goal.targets.contacted.toLocaleString('es-CL')} en tu meta de la semana`);
    lines.push({ kind: 'goal', text: `Meta de la semana: ${progressText(goal)}${step ? `. ${step.text}` : ''}`, href: step?.href || '/dashboard' });
  }
  return { subject, lines };
}

// ─── The email: the same lines, each a link back to the app ────────────────────────────────────────────────────────

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

/**
 * The email: each line is a link back to the app. With today's drop (the PDF is attached by the server) it has its own block
 * and button after the lines, so its line in the list is left out (it would say it twice) and «Abrir ANTON.IA» becomes a
 * quiet link: one main button per email.
 */
export function alertEmail(alert: DailyAlert, name: string, appUrl: string, drop?: AlertFacts['drop']) {
  const base = appUrl.replace(/\/$/, '');
  const link = (href: string) => `${base}${href}`;
  const settings = link('/dashboard?vista=semana');
  const greeting = name ? `Hola, ${name}` : 'Hola';
  const lines = drop?.items.length ? alert.lines.filter(line => line.kind !== 'drop') : alert.lines;
  const section = drop?.items.length ? dropEmailSection(drop.items, drop.id, base, { heading: lines.length > 0 }) : null;
  const intro = lines.length || !section ? 'Esto te espera hoy en ANTON.IA' : drop!.items.length === 1 ? 'Tu contacto del día ya está listo' : 'Tus contactos del día ya están listos';
  const text = [
    `${greeting}. ${intro}${lines.length ? ':' : '.'}`, '',
    ...lines.map(line => `- ${line.text} (${link(line.href)})`), ...(lines.length ? [''] : []),
    ...(section ? [section.text, ''] : []),
    `Abrir ANTON.IA: ${link('/dashboard')}`,
    `Te avisamos solo cuando hay algo que hacer. Los apagas en «Tu semana»: ${settings}`,
  ].join('\n');
  const rows = lines.map(line => `<p style="margin:0;padding:12px 0;border-top:1px solid #e5e7eb;font-size:15px;line-height:22px">`
    + `<a href="${escape(link(line.href))}" style="color:#111827;text-decoration:none">${escape(line.text)}<span style="color:#2563eb"> &rsaquo;</span></a></p>`).join('');
  const open = section
    ? `<p style="margin:24px 0 0;font-size:14px"><a href="${escape(link('/dashboard'))}" style="color:#2563eb;text-decoration:none">Abrir ANTON.IA &rsaquo;</a></p>`
    : `<p style="margin:24px 0 0"><a href="${escape(link('/dashboard'))}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">Abrir ANTON.IA</a></p>`;
  const html = emailShell(`<h1 style="margin:0 0 4px;font-size:20px;line-height:28px">${escape(greeting)}</h1>`
    + `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#6b7280">${escape(intro)}.</p>`
    + (lines.length ? `<div style="border-bottom:1px solid #e5e7eb">${rows}</div>` : '')
    + (section ? section.html : '')
    + open
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">Te avisamos solo cuando hay algo que hacer. Los apagas en <a href="${escape(settings)}" style="color:#6b7280">«Tu semana»</a>.</p>`);
  return { subject: alert.subject, text, html };
}
