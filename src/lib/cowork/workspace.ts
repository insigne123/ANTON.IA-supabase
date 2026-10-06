import type { AgendaItem, CoworkAgenda } from './agenda';

/**
 * What Cowork knows of the person's account when a turn starts (Plan 13): their contacts, campaigns and LinkedIn week, and what
 * is waiting for them today, from the same agenda «¿Qué toca hoy?» reads. It travels with every turn, so the coordinator answers
 * and prioritizes without spending reads to learn it, and can say in one line what the person should not miss, as a colleague
 * who keeps them up to date would. Small on purpose: counts and up to four named items, never addresses.
 */
export type CoworkWorkspace = {
  contacts: number | null;
  withEmail: number | null;
  campaigns: number | null;
  linkedin: { used: number; limit: number } | null;
  /** null when the agenda could not be read: unknown, never «nothing pending». */
  today: {
    /** Companies with someone interested waiting, and how many of them asked for a meeting. */
    interestedAccounts: number | null;
    meetingRequests: number | null;
    /** Campaign touches due today that nothing holds back. */
    followupsReady: number | null;
    /** Proposals waiting for the person's approval. */
    approvals: number | null;
    bounces: number | null;
    /** The most urgent, in the agenda's order: who and what, in the person's words. */
    first: Array<{ who: string; what: string }>;
    complete: boolean;
  } | null;
};

export const COWORK_WORKSPACE_MAX_ITEMS = 4;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One agenda item in the person's words: «pidió reunión hace 3 días», «6 correos de seguimiento listos para hoy». */
function itemLine(item: AgendaItem): { who: string; what: string } | null {
  const waited = typeof item.daysWaiting === 'number' ? (item.daysWaiting === 0 ? ' hoy' : ` hace ${plural(item.daysWaiting, 'día', 'días')}`) : '';
  const named = [item.who, item.company].filter(Boolean).join(' · ');
  switch (item.kind) {
    case 'meeting_request': return named ? { who: named, what: `pidió una reunión${waited}` } : null;
    case 'interested_reply': return named ? { who: named, what: `respondió con interés${waited}` } : null;
    case 'cooled_lead': return named ? { who: named, what: `mostró interés y espera respuesta${waited}` } : null;
    case 'unclassified_reply': return named ? { who: named, what: `respondió${waited} y falta leer su respuesta` } : null;
    case 'linkedin_accepted': return named ? { who: named, what: 'aceptó tu invitación de LinkedIn' } : null;
    case 'approval': return item.count ? { who: 'Tus aprobaciones', what: `${plural(item.count, 'propuesta espera', 'propuestas esperan')} tu visto bueno` } : null;
    case 'followups_due': return item.ready ? { who: item.campaign ? `Campaña «${item.campaign}»` : 'Tus campañas', what: `${plural(item.ready, 'correo de seguimiento listo', 'correos de seguimiento listos')} para hoy` } : null;
    case 'campaign_step': return item.count ? { who: 'Tus campañas', what: `${plural(item.count, 'paso espera', 'pasos esperan')} tu revisión` } : null;
    case 'bounce': return item.count ? { who: 'Tus envíos', what: `${plural(item.count, 'correo rebotó', 'correos rebotaron')}` } : null;
    default: return null;
  }
}

/** The digest of the account a turn carries. Null when nothing could be read. */
export function coworkWorkspaceDigest(input: {
  contacts: number | null; withEmail: number | null; campaigns: number | null;
  linkedin: { pending: number; sent7d: number; limit: number } | null;
  agenda: CoworkAgenda | null;
}): CoworkWorkspace | null {
  const { agenda } = input;
  const today = agenda ? {
    interestedAccounts: agenda.counts.interestedAccounts,
    meetingRequests: agenda.counts.ofWhichMeetingRequests,
    followupsReady: agenda.counts.followupsReady,
    approvals: agenda.counts.approvals,
    bounces: agenda.counts.bounces,
    first: [...agenda.items].sort((a, b) => a.rank - b.rank).flatMap(item => itemLine(item) ?? []).slice(0, COWORK_WORKSPACE_MAX_ITEMS),
    complete: agenda.complete,
  } : null;
  const linkedin = input.linkedin ? { used: input.linkedin.pending + input.linkedin.sent7d, limit: input.linkedin.limit } : null;
  if (input.contacts === null && input.withEmail === null && input.campaigns === null && !linkedin && !today) return null;
  return { contacts: input.contacts, withEmail: input.withEmail, campaigns: input.campaigns, linkedin, today };
}

/** How the coordinator uses it: to answer and prioritize without reading it again, and to bring up, once, what the person should not miss. */
export const COWORK_WORKSPACE_INSTRUCTION = 'workspace es el estado de la cuenta del usuario al empezar este trabajo: sus contactos guardados (y cuántos con correo), campañas, invitaciones de LinkedIn de la semana y lo que le espera hoy (today, el mismo orden de «¿Qué toca hoy?»). Úsalo para responder, priorizar y elegir el siguiente paso sin gastar lecturas en esas cifras; para el detalle de una persona o de una respuesta, consulta su lectura. Un valor null es desconocido, no cero. Sé proactivo como un colega que te pone al día: si today trae algo que el usuario no mencionó y que no conviene que se le pase (alguien pidió una reunión o respondió con interés y espera, propuestas esperando su aprobación), y no lo dijiste antes en este hilo (mira history), primero entrega completo lo que pidió y después, como última frase antes de tu pregunta de cierre, nómbralo con su dato empezando con «Por cierto» («Por cierto, Carolina Pérez pidió una reunión hace 2 días»), y agrega una respuesta sugerida para atenderlo. Nunca abras la respuesta con el aviso ni lo metas en un correo o documento; una sola mención por hilo; si el pedido ya es sobre eso, no lo repitas.';
