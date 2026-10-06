import { COWORK_HISTORY_FEEDBACK_INSTRUCTION, COWORK_PREVIOUS_VERSIONS_INSTRUCTION, type CoworkPreviousVersion } from './previous-versions';
import { coworkAgentInstructions } from './agent-instructions';
import { COWORK_AGENT_ACTION, COWORK_NOTE_ACTION, COWORK_PLAN_ACTION, COWORK_WRITTEN_ACTION } from './contracts';
import { COWORK_TURN_DEFAULTS, type CoworkTurnBudget } from './turn-budget';
import { COWORK_WORKSPACE_INSTRUCTION, type CoworkWorkspace } from './workspace';

/** The organization's working time zone. ANTON.IA schedules and reports in
 * Chile; override with COWORK_TIME_ZONE for another market. */

const withoutNulls = <T extends Record<string, unknown>>(values: T) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined)) as { [K in keyof T]?: NonNullable<T[K]> };

export const COWORK_DEFAULT_TIME_ZONE = 'America/Santiago';

/** Plain-language equivalents for codes that appear in tool results, so the
 * model never has to copy an internal value into what the user reads. */
export const COWORK_GLOSSARY: Record<string, string> = {
  last_7_days: 'últimos 7 días',
  last_30_days: 'últimos 30 días',
  per_contact: 'por contacto',
  contacted_leads: 'envíos registrados en ANTON.IA',
  own_saved_contacts: 'tus contactos (guardados y de «Por escribir»)',
  organization_contacted: 'envíos registrados del equipo',
  organization_replies: 'respuestas registradas del equipo',
  organization_metrics: 'métricas de la organización',
  coverage: 'si tu correo (o tu LinkedIn, en lecturas de LinkedIn) está sincronizado por completo con ANTON.IA (null: sin confirmar)',
  sweep: 'sincronización de LinkedIn con la extensión de ANTON.IA',
  truncated: 'hay más resultados que los mostrados',
  partial: 'la coincidencia no es exacta',
  needs_verification: 'por confirmar',
  needs_review: 'requiere revisión',
  do_not_contact: '«no contactar»',
  blocked: 'bloqueado',
  verified: 'correo verificado',
  unverified: 'correo sin verificar',
  unknown: 'sin confirmar',
  decision_maker_candidate: 'posible decisor (según el cargo)',
  referrer_candidate: 'posible referente (según el cargo)',
};

export function coworkTimeZone(value = typeof process === 'undefined' ? undefined : process.env?.COWORK_TIME_ZONE) {
  const zone = String(value || '').trim();
  if (!zone) return COWORK_DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: zone });
    return zone;
  } catch {
    return COWORK_DEFAULT_TIME_ZONE;
  }
}

function localNow(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** «25 sep 2026, 01:26» in the working time zone. */
export function coworkLocalStamp(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** The model converted UTC to local time unreliably (04:26Z shown as 10:26),
 * so every timestamp it reads travels with its local reading. Originals stay.
 * The judge reads the same data the same way (judge.ts). */
export function coworkWithLocalTimes(value: unknown, timeZone: string, depth = 0): unknown {
  if (depth > 8 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => coworkWithLocalTimes(item, timeZone, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = coworkWithLocalTimes(item, timeZone, depth + 1);
    const localKey = `${key}${key.includes('_') ? '_local' : 'Local'}`;
    if (typeof item !== 'string' || !TIMESTAMP.test(item) || localKey in value) continue;
    const date = new Date(item);
    if (!Number.isNaN(date.getTime())) output[localKey] = coworkLocalStamp(date, timeZone);
  }
  return output;
}

/** Who the person is and what they sell, read by the server once per run so a
 * draft is signed and pitched without spending reads on profile.get or
 * app.context. A missing value stays null: the model never fills it in. */
export type CoworkUserContext = {
  fullName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyDomain: string | null;
  offer: string | null;
  offerSource: 'profile' | 'organization' | null;
  /** What the person approved for ANTON.IA to remember (plan 2, V7); absent when there is nothing. */
  memories?: string[];
  /** From «Perfil», only when the person filled them in: products and services, results they
   * can show (usable as written) and their sector. */
  services?: string[];
  proofPoints?: string[];
  sector?: string;
  /** Why choose them and who they sell to, from «Perfil», only when filled in. */
  differentiators?: string[];
  idealCustomer?: { roles?: string[]; industries?: string[] };
  /** The mailbox that sends (Gmail or Outlook): the one chosen in Conexiones or the only connected one; absent when two
   * are connected and none was chosen, or none is (Plan 5, PR-6b). */
  sender?: string;
  /** The account when the turn starts: contacts, campaigns, LinkedIn week and what waits today (workspace.ts, Plan 13). */
  workspace?: CoworkWorkspace | null;
};

const USER_CONTEXT_INSTRUCTION = 'Datos del usuario leídos al iniciar este trabajo: firma con fullName (y jobTitle y companyName si existen) y redacta con offer y services, sin consultar profile.get ni app.context para eso. proofPoints son resultados que el usuario cargó en su perfil: se pueden citar tal cual. differentiators son razones para elegirlo que el usuario declaró: se pueden usar tal cual. idealCustomer (cargos e industrias) dice a quién le vende: úsalo para proponer búsquedas y elegir contactos. sender es la cuenta que envía sus correos (Gmail u Outlook): úsala como provider sin preguntar. Un valor null o ausente no se inventa.';
const MEMORIES_INSTRUCTION = ' memories son cosas que el usuario aprobó que ANTON.IA recuerde (preferencias, su negocio, cómo quiere que le escriban): síguelas al redactar y decidir, salvo que el pedido de ahora diga otra cosa, y no las presentes como datos consultados en este trabajo.';

const ANSWER_TO_CORRECT_INSTRUCTION = 'Esta es tu respuesta anterior. Edítala: cambia solo lo que señala rejectedDecisions y conserva el resto (lo que hiciste bien, sus cifras, nombres, tarjetas y tono). Si un bloque o el documento no cambian, puedes dejarlos en null: se conservan. No menciones la corrección ni que hubo una versión anterior.';
const clipText = (value: unknown, max: number) => typeof value === 'string' ? (value.length > max ? `${value.slice(0, max)}… [recortado]` : value) : null;

function withoutPrevious(rejection: unknown) {
  if (!rejection || typeof rejection !== 'object' || !('previous' in rejection)) return rejection;
  const { previous: _previous, ...rest } = rejection as Record<string, unknown>;
  return rest;
}

/** The answer the latest correction asks to edit, trimmed to a fair size: its cards whole when
 * they fit, their titles otherwise. */
function coworkAnswerToCorrect(rejections: unknown[] | undefined) {
  const previous = [...(rejections || [])].reverse()
    .map(item => item && typeof item === 'object' ? (item as { previous?: unknown }).previous : undefined)
    .find(value => value && typeof value === 'object') as Record<string, unknown> | undefined;
  if (!previous) return {};
  const blocks = Array.isArray(previous.blocks) && previous.blocks.length ? previous.blocks : null;
  const blocksJson = blocks ? JSON.stringify(blocks) : '';
  const document = previous.document && typeof previous.document === 'object' ? previous.document as { title?: unknown; content?: unknown } : null;
  return { answerToCorrect: {
    instruction: ANSWER_TO_CORRECT_INSTRUCTION,
    reply: clipText(previous.reply, 6000),
    question: clipText(previous.question, 400),
    suggestions: Array.isArray(previous.suggestions) ? previous.suggestions.slice(0, 3) : null,
    blocks: blocks ? (blocksJson.length <= 8000 ? blocks
      : blocks.map(block => ({ type: (block as { type?: unknown }).type, title: (block as { title?: unknown }).title }))) : null,
    document: document ? { title: clipText(document.title, 200), content: clipText(document.content, 6000) } : null,
  } };
}

const historyHasFeedback = (history: unknown) => Array.isArray((history as { turns?: unknown } | null)?.turns)
  && ((history as { turns: Array<{ feedback?: unknown }> }).turns).some(turn => Boolean(turn?.feedback));

/** Shared by the worker and AXIS replay. Time comes from the server, not the model. */
export function coworkDecisionContext(
  instructions: ReturnType<typeof coworkAgentInstructions>,
  {
    turnBudget, ...input
  }: { history: unknown; request: string; observations: unknown[]; mustAnswer: boolean; executionPolicy: unknown; rejectedDecisions?: unknown[];
    userContext?: CoworkUserContext | null;
    /** What the loop has left for this turn; without it, reads are counted from the observations.
     * Decisions stay the loop's business: it asks for the answer with mustAnswer. */
    turnBudget?: CoworkTurnBudget;
    /** The whole conversation beyond the last turns of history: its first request and its memory (thread-memory.ts). */
    threadMemory?: unknown;
    /** «Otra versión» (Plan 13): the answers already given to this same message, with what the person said about them. */
    previousVersions?: CoworkPreviousVersion[] },
  now = new Date(),
  timeZone = coworkTimeZone(),
) {
  const maximumReads = turnBudget?.reads ?? COWORK_TURN_DEFAULTS.reads;
  const readsUsed = input.observations.reduce<number>((used, item) => {
    const action = (item as { action?: string } | null)?.action;
    return used + (action === 'specialists.review' || action === COWORK_NOTE_ACTION || action === COWORK_PLAN_ACTION || action === COWORK_AGENT_ACTION || action === COWORK_WRITTEN_ACTION ? 0
      : action === 'privacy.contactability_batch' || action === 'lists.review_batch' ? maximumReads : 1);
  }, 0);
  const observedLeadIds = new Set<string>();
  for (const observation of input.observations) {
    const result = (observation as { result?: { items?: Array<{ lead_id?: string }> } } | null)?.result;
    for (const item of result?.items || []) {
      if (typeof item.lead_id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.lead_id)) observedLeadIds.add(item.lead_id);
    }
  }
  return {
    ...input,
    userContext: input.userContext ? { ...input.userContext,
      instruction: USER_CONTEXT_INSTRUCTION + (input.userContext.memories?.length ? MEMORIES_INSTRUCTION : '')
        + (input.userContext.workspace ? ` ${COWORK_WORKSPACE_INSTRUCTION}` : '') } : null,
    history: coworkWithLocalTimes(input.history, timeZone) as typeof input.history,
    // What the person said about the answers of the conversation (👍/👎, Plan 13) shapes this one.
    ...(historyHasFeedback(input.history) ? { historyFeedbackInstruction: COWORK_HISTORY_FEEDBACK_INSTRUCTION } : {}),
    ...(input.previousVersions?.length ? { previousVersions: input.previousVersions, previousVersionsInstruction: COWORK_PREVIOUS_VERSIONS_INSTRUCTION } : {}),
    observations: coworkWithLocalTimes(input.observations, timeZone) as unknown[],
    // A correction edits the answer it was asked to fix: it travels apart from the reasons.
    ...(input.rejectedDecisions ? { rejectedDecisions: input.rejectedDecisions.map(withoutPrevious) } : {}),
    ...coworkAnswerToCorrect(input.rejectedDecisions),
    contactReadGuidance: {
      observedLeadIds: [...observedLeadIds],
      instruction: input.observations.length === 0
        ? 'Si necesitas descubrir contactos: action contacted.search, query "", leadId null, reads null, plan null. Espera su resultado antes de construir consultas por UUID. Nunca uses referencias, placeholders ni IDs de tareas como UUID.'
        : 'Para cronología usa lead_id observado (no id del registro de envío). Si no está confirmado que el correo esté sincronizado y el usuario pide su correo, gmail.contact_history permite contrastar metadatos de su Gmail; no sincroniza toda la empresa. No repitas la misma fuente para inventar cobertura.',
    },
    // The plan belongs to the first consulting decision (rule 12); repeating it only costs output.
    ...(input.observations.length ? { planStatus: 'El plan ya se mostró: en esta decisión outline es null.' } : {}),
    readBudget: {
      maximum: maximumReads,
      remaining: turnBudget?.readsLeft ?? Math.max(0, maximumReads - readsUsed),
      instruction: 'No repitas una consulta ya observada en esta ejecución ni en el hilo reciente. Si no está confirmado que el correo esté sincronizado, volver a leer la misma fuente no lo confirma: responde con lo que sabes y el próximo paso disponible.',
    },
    clock: { serverNow: now.toISOString(), timezone: 'UTC', source: 'server', timeZone, localNow: localNow(now, timeZone) },
    glossary: COWORK_GLOSSARY,
    // A capability the turn's intents leave out (intents.ts) is null and does not travel.
    ...withoutNulls({
      parallelReadCapability: instructions.parallelReadCapability,
      researchCapability: instructions.researchCapability,
      externalSearchCapability: instructions.externalSearchCapability,
      extendedReadCapability: instructions.extendedReadCapability,
      replyDetectionCapability: instructions.replyDetectionCapability,
      metricsCapability: instructions.metricsCapability,
      deliverabilityCapability: instructions.deliverabilityCapability,
      complianceCapability: instructions.complianceCapability,
      additionalCapability: instructions.additionalCapability,
      effectCapability: instructions.effectCapability,
    }),
    // The Writer needs a decision in reserve in case it fails: on the last one the coordinator writes.
    ...(instructions.writerCapability ? { writerCapability: instructions.writerCapability, writerAvailable: (turnBudget?.decisionsLeft ?? 1) > 0 } : {}),
    ...(instructions.contactsImportCapability ? { contactsImportCapability: instructions.contactsImportCapability } : {}),
    ...(instructions.linkedinBatchCapability ? { linkedinBatchCapability: instructions.linkedinBatchCapability } : {}),
    ...(instructions.campaignRetryCapability ? { campaignRetryCapability: instructions.campaignRetryCapability } : {}),
    ...(instructions.phoneRevealCapability ? { phoneRevealCapability: instructions.phoneRevealCapability } : {}),
    ...(instructions.prepareBatchCapability ? { prepareBatchCapability: instructions.prepareBatchCapability } : {}),
    ...(instructions.artifactCapability ? { artifactCapability: instructions.artifactCapability } : {}),
    ...(instructions.analystCapability ? { analystCapability: instructions.analystCapability, analystAvailable: (turnBudget?.decisionsLeft ?? 1) > 0 } : {}),
    ...(instructions.preferenceCapability ? { preferenceCapability: instructions.preferenceCapability } : {}),
    threadBudgetCapability: instructions.threadBudgetCapability,
  };
}
