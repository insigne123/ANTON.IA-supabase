// The email a person gets when an opportunity is assigned to them: who assigned it, what it is, when it closes and what is expected
// first. One per person and assignment, on the same white card as the morning «Avisos» and with the same off switch (Tu semana).
// Pure: the server reads the facts (server/commercial-opportunities/workspace-assignment-notice.ts).
import { emailShell } from '@/lib/email-shell';

export type AssignmentEmailInput = {
  name: string;
  /** Who assigned it; null when it is not known (the email then says «Un administrador»). */
  assignedBy: string | null;
  opportunityId: string;
  title: string;
  buyer: string | null;
  deadlineAt: string | null;
  nextActionAt: string | null;
  objective: string;
  /** Whether the person was left in charge. */
  responsible: boolean;
  appUrl: string;
};

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** «jueves 23 de octubre, 15:00», in Chile time; empty when the date is missing or not a date. */
export function assignmentWhen(at: string | null | undefined) {
  const time = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return '';
  const parts = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(time));
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('weekday')} ${part('day')} de ${part('month')}, ${part('hour')}:${part('minute')}`;
}

export function assignmentEmail(input: AssignmentEmailInput) {
  const base = input.appUrl.replace(/\/$/, '');
  const link = `${base}/opportunities?op=${encodeURIComponent(input.opportunityId)}`;
  const settings = `${base}/dashboard?vista=semana`;
  const who = input.assignedBy?.trim() || 'Un administrador';
  const greeting = input.name.trim() ? `Hola, ${input.name.trim()}` : 'Hola';
  const title = clip(input.title.replace(/\s+/g, ' ').trim() || 'Oportunidad', 160);
  const subject = `${input.responsible ? 'Quedaste a cargo' : 'Te asignaron'}: ${clip(title, 90)}`;
  const intro = `${who} ${input.responsible ? 'te dejó a cargo de' : 'te asignó'} esta oportunidad.`;
  const details = ([
    ['Organismo o empresa', input.buyer?.trim() || ''],
    ['Cierra', assignmentWhen(input.deadlineAt)],
    ['Próxima acción', assignmentWhen(input.nextActionAt)],
    ['Qué se espera', clip(input.objective.replace(/\s+/g, ' ').trim(), 400)],
  ] as const).filter(([, value]) => value);
  const text = [
    `${greeting}. ${intro}`, '', title, ...details.map(([label, value]) => `${label}: ${value}`), '',
    `Abrir la oportunidad: ${link}`,
    `Te avisamos solo cuando hay algo que hacer. Los apagas en «Tu semana»: ${settings}`,
  ].join('\n');
  const rows = details.map(([label, value]) => `<p style="margin:0;padding:8px 0;border-top:1px solid #e5e7eb;font-size:14px;line-height:21px"><span style="color:#6b7280">${escape(label)}: </span>${escape(value)}</p>`).join('');
  const html = emailShell(`<h1 style="margin:0 0 4px;font-size:20px;line-height:28px">${escape(greeting)}</h1>`
    + `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#6b7280">${escape(intro)}</p>`
    + `<p style="margin:0 0 8px;font-size:16px;line-height:24px;font-weight:600">${escape(title)}</p>`
    + (rows ? `<div style="border-bottom:1px solid #e5e7eb">${rows}</div>` : '')
    + `<p style="margin:24px 0 0"><a href="${escape(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">Abrir la oportunidad</a></p>`
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">Te avisamos solo cuando hay algo que hacer. Los apagas en <a href="${escape(settings)}" style="color:#6b7280">«Tu semana»</a>.</p>`);
  return { subject, text, html };
}
