import { dayInZone, dayStartInZone, shiftDay } from '@/lib/admin/chile-time';

/**
 * «Informe semanal» (propuesta 2): one report per person with a section for each role they have. Everyone gets «Tu
 * semana»; owners and admins also «Equipo»; whoever an admin names «Gestor de oportunidades» (or the admins, while nobody is)
 * also «Oportunidades». It is read in the app at any time, and on Mondays at 8:00 it can arrive by email, sent by the person
 * to themselves from their own connected mailbox. Everything here is pure: the server reads (server/weekly-report.ts).
 */

export type ReportRole = 'personal' | 'team' | 'opportunities';
export const REPORT_ROLES: Array<{ id: ReportRole; label: string }> = [
  { id: 'personal', label: 'Tu semana' }, { id: 'team', label: 'Equipo' }, { id: 'opportunities', label: 'Oportunidades' },
];

export type ReportWeek = { which: 'current' | 'previous'; start: string; end: string; from: string; to: string; previousFrom: string; previousTo: string; label: string };

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const dayLabel = (day: string, withMonth: boolean) => `${Number(day.slice(8, 10))}${withMonth ? ` ${MONTHS[Number(day.slice(5, 7)) - 1]}` : ''}`;

/** «13–19 oct», «29 sept – 5 oct». */
export function weekLabel(start: string, end: string) {
  return start.slice(5, 7) === end.slice(5, 7) ? `${dayLabel(start, false)}–${dayLabel(end, true)}` : `${dayLabel(start, true)} – ${dayLabel(end, true)}`;
}

/**
 * The week in Chile: Monday 00:00 to Sunday 24:00. «previous» is the last complete week (what Monday's email tells);
 * «current» runs from this Monday until now, and compares with the same days of the week before.
 */
export function reportWeek(now: Date, which: 'current' | 'previous'): ReportWeek {
  const today = dayInZone(now);
  const weekday = (new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  const start = shiftDay(today, -weekday - (which === 'previous' ? 7 : 0));
  const end = shiftDay(start, 6);
  const from = dayStartInZone(start);
  const to = which === 'previous' ? dayStartInZone(shiftDay(start, 7)) : now;
  const previousFrom = dayStartInZone(shiftDay(start, -7));
  const previousTo = new Date(previousFrom.getTime() + (to.getTime() - from.getTime()));
  return { which, start, end, from: from.toISOString(), to: to.toISOString(), previousFrom: previousFrom.toISOString(), previousTo: previousTo.toISOString(), label: weekLabel(start, end) };
}

export type Counted = { now: number; before: number };
export type PendingReply = { id: string; name: string; company: string | null; repliedAt: string };
export type Commitment = { id: string; name: string; company: string | null; title: string; dueAt: string };
export type PersonalSection = {
  sent: Counted; contacted: Counted; replies: Counted; meetings: number;
  pending: PendingReply[]; commitments: Commitment[]; touches: { calls: number; linkedin: number } | null;
};
/** `detail` is the member's email, only when another member has the same name. */
export type TeamMember = { userId: string; name: string; detail?: string | null; role: string; sent: number; replies: number; meetings: number; pending: number };
export type TeamSection = { members: TeamMember[]; totals: { sent: Counted; replies: Counted; meetings: number } };
export type ClosingOpportunity = { id: string; kind: string; title: string; buyer: string | null; deadlineAt: string; amount: number | null; currency: string | null; assigned: boolean };
export type OpportunitiesSection = {
  found: { total: number; recommended: number; byKind: Array<{ kind: string; label: string; count: number }> };
  closing: ClosingOpportunity[]; unassignedClosing: number; won: number; lost: number;
};
export type WeeklyReport = {
  week: ReportWeek; roles: ReportRole[]; name: string;
  personal: PersonalSection; team: TeamSection | null; opportunities: OpportunitiesSection | null;
};

export const OPPORTUNITY_KINDS: Record<string, string> = {
  tender: 'Licitaciones', compra_agil: 'Compras Ágiles', hiring: 'Empresas contratando', project: 'Proyectos de inversión',
  linkedin_post: 'Publicaciones de LinkedIn', private: 'Propias',
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;
export const rate = (replies: number, contacted: number) => contacted ? Math.round((replies / contacted) * 100) : null;

/** «+5 vs. la semana anterior», «igual que la semana anterior»; null without a week before to compare. */
export function deltaText(counted: Counted) {
  if (!counted.now && !counted.before) return null;
  const delta = counted.now - counted.before;
  return delta === 0 ? 'igual que la semana anterior' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('es-CL')} vs. la semana anterior`;
}

/** One sentence with what matters of the week, for the top of the page and of the email. */
export function personalHeadline(section: PersonalSection, which: ReportWeek['which']) {
  const when = which === 'previous' ? 'La semana pasada' : 'Esta semana';
  const answered = section.replies.now === 1 ? 'te respondió 1 persona' : `te respondieron ${section.replies.now.toLocaleString('es-CL')}`;
  const percent = rate(section.replies.now, section.contacted.now);
  // Replies can come in a week without sends: they answer the emails of the weeks before.
  const first = !section.contacted.now
    ? `${when} no enviaste correos${section.replies.now ? `, pero ${answered}` : ''}.`
    : `${when} escribiste a ${plural(section.contacted.now, 'persona', 'personas')}${section.replies.now ? ` y ${answered}${percent !== null ? ` (${percent} %)` : ''}` : ''}.`;
  return [
    first,
    section.meetings ? `${section.meetings === 1 ? 'Una pidió' : `${section.meetings} pidieron`} reunión.` : '',
    section.pending.length ? `Te ${section.pending.length === 1 ? 'espera una respuesta' : `esperan ${section.pending.length} respuestas`}.` : '',
  ].filter(Boolean).join(' ');
}

export type NextAction = { text: string; href: string };

const dueDay = (at: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', timeZone: 'America/Santiago' }).format(new Date(at));

/** Up to three things for the coming days, the most urgent first. */
export function nextActions(report: Pick<WeeklyReport, 'personal' | 'team' | 'opportunities'>): NextAction[] {
  const { personal, team, opportunities } = report;
  const actions: NextAction[] = [];
  if (personal.pending.length) actions.push({ text: `Responde a ${plural(personal.pending.length, 'persona que te escribió', 'personas que te escribieron')}`, href: '/contacted/replied' });
  const commitment = personal.commitments[0];
  if (commitment) actions.push({ text: `${commitment.title} con ${commitment.name}, el ${dueDay(commitment.dueAt)}${personal.commitments.length > 1 ? ` (y ${personal.commitments.length - 1} más)` : ''}`, href: `/contacted?c=${encodeURIComponent(commitment.id)}` });
  if (opportunities?.unassignedClosing) actions.push({ text: `Asigna ${plural(opportunities.unassignedClosing, 'oportunidad que cierra', 'oportunidades que cierran')} esta semana`, href: '/opportunities' });
  const quiet = team?.members.filter(member => !member.sent) || [];
  if (quiet.length && team && quiet.length < team.members.length) actions.push({ text: `Revisa con ${quiet.length === 1 ? quiet[0].name : `${quiet.length} personas del equipo`} por qué no ${quiet.length === 1 ? 'envió' : 'enviaron'} correos`, href: '/dashboard/admin/usage' });
  if (personal.sent.now < Math.max(1, personal.sent.before)) actions.push({ text: 'Escribe a tus contactos listos en «Por escribir»', href: '/saved/leads/enriched' });
  return actions.slice(0, 3);
}

// ─── The email: the same report, in a few lines, with links back to the app ─────────────────────────────────────────

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const money = (amount: number | null, currency: string | null) => amount ? `${currency === 'USD' ? 'US$' : '$'}${Math.round(amount).toLocaleString('es-CL')}` : null;
const closingDay = (at: string) => new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Santiago' }).format(new Date(at)).replace(/\./g, '');

export function reportEmail(report: WeeklyReport, appUrl: string) {
  const base = appUrl.replace(/\/$/, '');
  const link = (href: string) => `${base}${href}`;
  const { personal, team, opportunities, week } = report;
  const lines: string[] = [];
  const html: string[] = [];
  const section = (title: string) => { lines.push('', title.toUpperCase()); html.push(`<h2 style="margin:28px 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">${escape(title)}</h2>`); };
  const row = (text: string, href?: string) => {
    lines.push(`- ${text}${href ? ` (${link(href)})` : ''}`);
    html.push(`<p style="margin:6px 0;font-size:15px;line-height:22px;color:#111827">${href ? `<a href="${escape(link(href))}" style="color:#2563eb;text-decoration:none">${escape(text)}</a>` : escape(text)}</p>`);
  };
  const headline = personalHeadline(personal, week.which);
  lines.push(`Tu informe semanal · ${week.label}`, '', headline);
  html.push(`<p style="margin:0 0 4px;font-size:13px;color:#6b7280">Informe semanal · ${escape(week.label)}</p>`,
    `<h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111827">${escape(report.name ? `Hola, ${report.name}` : 'Hola')}</h1>`,
    `<p style="margin:0;font-size:16px;line-height:24px;color:#111827">${escape(headline)}</p>`);
  const actions = nextActions(report);
  if (actions.length) { section('Para esta semana'); actions.forEach(action => row(action.text, action.href)); }
  section('Tu semana');
  row(`${plural(personal.sent.now, 'correo enviado', 'correos enviados')} · ${plural(personal.replies.now, 'respuesta', 'respuestas')} · ${plural(personal.meetings, 'reunión pedida', 'reuniones pedidas')}`);
  if (personal.touches && (personal.touches.calls || personal.touches.linkedin)) row(`${plural(personal.touches.calls, 'llamada', 'llamadas')} y ${plural(personal.touches.linkedin, 'contacto', 'contactos')} por LinkedIn`);
  if (team) {
    section('Equipo');
    row(`${plural(team.totals.sent.now, 'correo enviado', 'correos enviados')} y ${plural(team.totals.replies.now, 'respuesta', 'respuestas')} entre ${plural(team.members.length, 'persona', 'personas')}`);
    team.members.slice(0, 8).forEach(member => row(`${member.name}${member.detail ? ` (${member.detail})` : ''}: ${member.sent} enviados, ${member.replies} respuestas${member.pending ? `, ${member.pending} por responder` : ''}`));
  }
  if (opportunities) {
    section('Oportunidades');
    row(`${plural(opportunities.found.total, 'oportunidad nueva', 'oportunidades nuevas')}${opportunities.found.recommended ? `, ${opportunities.found.recommended} recomendadas` : ''}`, '/opportunities');
    opportunities.closing.slice(0, 5).forEach(item => row(`Cierra el ${closingDay(item.deadlineAt)}: ${item.title}${item.buyer ? ` · ${item.buyer}` : ''}${money(item.amount, item.currency) ? ` · ${money(item.amount, item.currency)}` : ''}${item.assigned ? '' : ' · sin asignar'}`, `/opportunities?op=${item.id}`));
  }
  lines.push('', `Ver el informe completo: ${link('/weekly-report')}`, 'Lo recibes porque lo activaste en «Informe semanal». Lo apagas en la misma página.');
  html.push(`<p style="margin:28px 0 0"><a href="${escape(link('/weekly-report'))}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">Ver el informe completo</a></p>`,
    '<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">Lo recibes porque lo activaste en «Informe semanal» de ANTON.IA. Lo apagas en la misma página.</p>');
  return {
    subject: `Tu informe semanal · ${week.label}`,
    text: lines.join('\n'),
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">${html.join('')}</div>`,
  };
}
