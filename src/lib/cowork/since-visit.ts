/**
 * «Desde tu última visita» (Plan 12, 5): what changed since the person last asked Cowork something, read from data that
 * already exists (replies, finished research, new opportunities, accepted invitations). Each item says what happened, with
 * up to two names, and carries the request that works on it when tapped. Pure: the server reads, this words it.
 */

export type CoworkSinceKind = 'replies' | 'research' | 'opportunities' | 'linkedin';
export type CoworkSinceItem = { kind: CoworkSinceKind; count: number; text: string; prompt: string };
/** `at` is the last visit (the person's last own turn); `items` is empty when nothing changed since. */
export type CoworkSince = { at: string; items: CoworkSinceItem[] };

export type CoworkSinceInput = {
  /** Replies received since, without automatic ones. `meeting` marks a reply that asks for a meeting. */
  replies: Array<{ name: string | null; company: string | null; meeting: boolean }> | null;
  research: Array<{ name: string | null; company: string | null }> | null;
  opportunities: { tenders: number; hiring: number; projects: number } | null;
  linkedin: Array<{ name: string | null }> | null;
};

/** The longest look back: an old visit shows the last two weeks, not everything that ever happened. */
export const COWORK_SINCE_MAX_DAYS = 14;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** «Marcela Rojas (Constructora Andes)», «Héctor Vidal y Ana Ruiz», «Marcela Rojas, Héctor Vidal y 3 más». */
export function coworkSinceNames(people: Array<{ name: string | null; company?: string | null }>, max = 2) {
  const named = people.map(person => {
    const name = person.name?.trim();
    const company = person.company?.trim();
    return name ? (company && people.length === 1 ? `${name} (${company})` : name) : company || null;
  }).filter((value): value is string => Boolean(value));
  const unique = [...new Set(named)];
  if (!unique.length) return '';
  const shown = unique.slice(0, max);
  const rest = unique.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} y ${rest} más`;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} y ${shown[shown.length - 1]}`;
}

export function coworkSinceItems(input: CoworkSinceInput): CoworkSinceItem[] {
  const items: CoworkSinceItem[] = [];
  const replies = input.replies || [];
  if (replies.length) {
    // Who asks for a meeting comes first, in the names and in the request.
    const ordered = [...replies].sort((a, b) => Number(b.meeting) - Number(a.meeting));
    const meetings = replies.filter(reply => reply.meeting).length;
    items.push({
      kind: 'replies', count: replies.length,
      text: `${replies.length} ${plural(replies.length, 'respuesta nueva', 'respuestas nuevas')}: ${coworkSinceNames(ordered)}${meetings ? ` · ${meetings} ${plural(meetings, 'pide', 'piden')} reunión` : ''}`,
      prompt: meetings
        ? '¿Quién me respondió desde mi última visita? Prepárame las respuestas, partiendo por quien pide reunión.'
        : '¿Quién me respondió desde mi última visita? Prepárame las respuestas.',
    });
  }
  const research = input.research || [];
  if (research.length) {
    items.push({
      kind: 'research', count: research.length,
      text: `${research.length} ${plural(research.length, 'investigación lista', 'investigaciones listas')}: ${coworkSinceNames(research)}`,
      prompt: 'Muéstrame lo que encontraste en las investigaciones que terminaron y qué le escribirías a cada uno.',
    });
  }
  const opportunities = input.opportunities;
  const total = opportunities ? opportunities.tenders + opportunities.hiring + opportunities.projects : 0;
  if (opportunities && total) {
    const parts = [
      opportunities.tenders ? `${opportunities.tenders} ${plural(opportunities.tenders, 'licitación o Compra Ágil', 'licitaciones o Compras Ágiles')}` : null,
      opportunities.hiring ? `${opportunities.hiring} ${plural(opportunities.hiring, 'empresa contratando', 'empresas contratando')}` : null,
      opportunities.projects ? `${opportunities.projects} ${plural(opportunities.projects, 'proyecto SEIA', 'proyectos SEIA')}` : null,
    ].filter(Boolean);
    items.push({
      kind: 'opportunities', count: total,
      text: `${total} ${plural(total, 'oportunidad nueva', 'oportunidades nuevas')}: ${parts.join(', ')}`,
      prompt: '¿Qué oportunidades nuevas hay desde mi última visita y cuál me conviene mirar primero?',
    });
  }
  const linkedin = input.linkedin || [];
  if (linkedin.length) {
    items.push({
      kind: 'linkedin', count: linkedin.length,
      text: `${linkedin.length} ${plural(linkedin.length, 'aceptó', 'aceptaron')} tu invitación de LinkedIn: ${coworkSinceNames(linkedin)}`,
      prompt: 'Prepárame un mensaje de LinkedIn para quienes aceptaron mi invitación y aún no les escribo.',
    });
  }
  return items;
}

/** When the last visit was, in words: «hoy», «ayer», «hace 3 días» (Chile time, by calendar day). */
export function coworkSinceWhen(at: string, now: Date = new Date(), timeZone = 'America/Santiago') {
  const day = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const days = Math.round((Date.parse(day(now)) - Date.parse(day(new Date(at)))) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

/** Where to look from: the last visit, but never further back than COWORK_SINCE_MAX_DAYS. */
export function coworkSinceFrom(lastVisit: string, nowMs: number) {
  return new Date(Math.max(Date.parse(lastVisit), nowMs - COWORK_SINCE_MAX_DAYS * 86_400_000)).toISOString();
}
