// The email when something on an opportunity waits for someone: a decision asked of the administrators, a proposal not to apply, a
// block, the answer to the decision, a note that names someone with «@» or tasks given to someone. Before, these only left a line in
// «Novedades» inside the page, and a decision waited until an administrator happened to open it. On the same white card as the assignment email, with the same off switch (Tu semana).
// Pure: the server reads the facts (server/commercial-opportunities/workspace-decision-notice.ts).
import { emailShell } from '@/lib/email-shell';
import { assignmentWhen } from './assignment-email';

export type DecisionNoticeKind = 'ask' | 'no_go' | 'blocked' | 'reply' | 'mention' | 'task';
export type DecisionEmailInput = {
  name: string;
  /** Who asked, blocked, answered, wrote the note or gave the tasks; null when it is not known. */
  actor: string | null;
  kind: DecisionNoticeKind;
  title: string;
  /** What they wrote: the decision, the reason of the block, the answer or the note; for tasks, their names. */
  text: string;
  /** The date the decision is needed by, or the first task is due, when there is one. */
  dueAt: string | null;
  /** How many tasks were given, for a «task» email. */
  count?: number;
  opportunityId: string;
  appUrl: string;
};

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function decisionEmail(input: DecisionEmailInput) {
  const base = input.appUrl.replace(/\/$/, '');
  const section = input.kind === 'mention' ? '&seccion=actividad' : input.kind === 'task' ? '&seccion=tareas' : '';
  const link = `${base}/opportunities?op=${encodeURIComponent(input.opportunityId)}${section}`;
  const settings = `${base}/dashboard?vista=semana`;
  const who = input.actor?.trim() || (input.kind === 'reply' ? 'Un administrador' : 'Alguien del equipo');
  const greeting = input.name.trim() ? `Hola, ${input.name.trim()}` : 'Hola';
  const title = clip(input.title.replace(/\s+/g, ' ').trim() || 'Oportunidad', 160);
  const said = clip(input.text.replace(/\s+/g, ' ').trim(), 600);
  const when = assignmentWhen(input.dueAt).replace(/,\s*\d{2}:\d{2}$/, '');
  const [subjectStart, intro, action] = {
    ask: [`${who} pide una decisión`, `${who} necesita que decidan algo sobre esta oportunidad${when ? `, para el ${when}` : ''}.`, 'Responder'],
    no_go: [`${who} propone no postular`, `${who} propone no postular a esta oportunidad${when ? `; necesita la respuesta para el ${when}` : ''}.`, 'Responder'],
    blocked: ['Oportunidad bloqueada', `${who} marcó esta oportunidad como bloqueada.`, 'Ver qué la bloquea'],
    reply: ['Respondieron tu decisión', `${who} respondió la decisión que pediste.`, 'Abrir la oportunidad'],
    mention: [`${who} te mencionó`, `${who} te mencionó en una nota de esta oportunidad.`, 'Ver la nota'],
    task: [(input.count ?? 1) > 1 ? `${input.count} tareas para ti` : 'Una tarea para ti',
      `${who} te dio ${(input.count ?? 1) > 1 ? `${input.count} tareas` : 'una tarea'} en esta oportunidad${when ? `; ${(input.count ?? 1) > 1 ? 'la primera vence' : 'vence'} el ${when}` : ''}.`,
      (input.count ?? 1) > 1 ? 'Ver las tareas' : 'Ver la tarea'],
  }[input.kind];
  const subject = `${subjectStart}: ${clip(title, 90)}`;
  const text = [`${greeting}. ${intro}`, '', title, ...(said ? [`«${said}»`] : []), '', `${action}: ${link}`,
    `Te avisamos solo cuando hay algo que hacer. Los apagas en «Tu semana»: ${settings}`].join('\n');
  const html = emailShell(`<h1 style="margin:0 0 4px;font-size:20px;line-height:28px">${escape(greeting)}</h1>`
    + `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#6b7280">${escape(intro)}</p>`
    + `<p style="margin:0 0 8px;font-size:16px;line-height:24px;font-weight:600">${escape(title)}</p>`
    + (said ? `<p style="margin:0;padding:12px 14px;border-left:3px solid #e5e7eb;font-size:14px;line-height:21px">${escape(said)}</p>` : '')
    + `<p style="margin:24px 0 0"><a href="${escape(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-size:14px">${escape(action)}</a></p>`
    + `<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#6b7280">Te avisamos solo cuando hay algo que hacer. Los apagas en <a href="${escape(settings)}" style="color:#6b7280">«Tu semana»</a>.</p>`);
  return { subject, text, html };
}
