/**
 * When the research Cowork started in a conversation finishes, the conversation goes on by itself (Plan 5, PR-5):
 * «Terminaron las investigaciones de Rafael y Susana». The worker checks every minute; it waits for every research of
 * a request, or tells about the finished ones after 10 minutes and about the rest when they finish.
 */

export const COWORK_RESEARCH_NOTICE_WAIT_MS = 10 * 60_000;
/** The marker on the run that started the research: which jobs were told about, in which notice. */
export const COWORK_RESEARCH_NOTICE_EVENT = 'research.notified';
const TERMINAL = new Set(['completed', 'partial', 'insufficient_data', 'failed']);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^cowork:(${UUID}):lead:(${UUID}):research-v1$`, 'i');

/** The run that started a research and the contact it is about, from the request key Cowork gives every research. */
export function coworkResearchKey(key: string | null | undefined): { runId: string; leadId: string } | null {
  const match = KEY.exec(String(key || ''));
  return match ? { runId: match[1].toLowerCase(), leadId: match[2].toLowerCase() } : null;
}

export function coworkResearchFinished(status: string) {
  return TERMINAL.has(status);
}

export type CoworkResearchJob = { id: string; leadId: string; status: string; errorCode: string | null; createdAt: string };

/** The jobs to tell about now: all of them once all finished, or after 10 minutes the finished ones. */
export function coworkResearchNoticeDue<T extends CoworkResearchJob>(pending: T[], now: Date): T[] {
  const done = pending.filter(job => coworkResearchFinished(job.status));
  if (!done.length) return [];
  if (done.length === pending.length) return done;
  const oldest = Math.min(...pending.map(job => Date.parse(job.createdAt)).filter(Number.isFinite));
  return now.getTime() - oldest >= COWORK_RESEARCH_NOTICE_WAIT_MS ? done : [];
}

/** How a research ended, in the words the person reads. */
export function coworkResearchStatusText(status: string, errorCode?: string | null) {
  if (status === 'completed') return 'lista';
  if (status === 'partial') return 'lista, con vacíos';
  if (status === 'insufficient_data') return 'sin datos suficientes para un informe';
  if (status === 'failed') return errorCode === 'daily_research_quota_exceeded' ? 'no se hizo: se acabó el cupo diario de investigaciones' : 'no se pudo completar';
  return 'sigue en curso';
}

export type CoworkResearchNoticePerson = { leadId: string; name: string | null; company: string | null; status: string; errorCode?: string | null };

/** What the conversation receives: who, how each ended, and what to do with it. */
export function coworkResearchNoticeMessage(done: CoworkResearchNoticePerson[], running: Array<Pick<CoworkResearchNoticePerson, 'name' | 'company'>> = []) {
  const who = (person: Pick<CoworkResearchNoticePerson, 'name' | 'company'>) =>
    [person.name || 'Contacto sin nombre', person.company ? `(${person.company})` : ''].filter(Boolean).join(' ');
  const ready = done.some(person => ['completed', 'partial', 'insufficient_data'].includes(person.status));
  return [
    `${done.length === 1 ? 'Terminó la investigación' : 'Terminaron las investigaciones'} que pediste en esta conversación:`,
    ...done.map(person => `- ${who(person)}, leadId ${person.leadId}: ${coworkResearchStatusText(person.status, person.errorCode)}.`),
    ...(running.length ? [`Sigue${running.length === 1 ? '' : 'n'} en curso: ${running.map(who).join(', ')}. Te aviso aquí cuando termine${running.length === 1 ? '' : 'n'}.`] : []),
    ready
      ? 'Lee cada informe listo con research.get_existing y entrégalos completos en document («Informes de la investigación»): una sección por persona con su informe tal como viene en report.sections, con sus títulos (la persona, su empresa, las oportunidades, cómo abrir la conversación y las preguntas), sin resumirlo; si report es null, di por qué con reportMessage y usa la evidencia. En reply, una línea por persona con lo más útil para escribirle y qué faltó. Si no alcanzas a leerlos todos en este turno, entrega los que leíste y ofrece seguir con el resto. Luego propone el siguiente paso concreto, por ejemplo los borradores de correo.'
      : 'Cuéntale al usuario qué pasó con cada una y qué puede hacer ahora.',
    'No inicies investigaciones nuevas ni repitas las que siguen en curso.',
  ].join('\n');
}

/** For the conversation: «Investigando 2 · 1 lista». */
export function coworkResearchProgressLabel(statuses: string[]) {
  const finished = statuses.filter(coworkResearchFinished).length;
  const running = statuses.length - finished;
  if (!statuses.length) return '';
  if (!running) return statuses.length === 1 ? 'Investigación terminada' : `${statuses.length} investigaciones terminadas`;
  return `Investigando ${running}${finished ? ` · ${finished} ${finished === 1 ? 'lista' : 'listas'}` : ''}`;
}
