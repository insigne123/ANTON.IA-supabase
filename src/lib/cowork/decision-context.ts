import { coworkAgentInstructions } from './agent-instructions';
import { COWORK_NOTE_ACTION, COWORK_PLAN_ACTION } from './contracts';

/** The organization's working time zone. ANTON.IA schedules and reports in
 * Chile; override with COWORK_TIME_ZONE for another market. */
export const COWORK_DEFAULT_TIME_ZONE = 'America/Santiago';

/** Plain-language equivalents for codes that appear in tool results, so the
 * model never has to copy an internal value into what the user reads. */
export const COWORK_GLOSSARY: Record<string, string> = {
  last_7_days: 'últimos 7 días',
  last_30_days: 'últimos 30 días',
  per_contact: 'por contacto',
  contacted_leads: 'envíos registrados en ANTON.IA',
  own_saved_contacts: 'tus contactos guardados',
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
 * so every timestamp it reads travels with its local reading. Originals stay. */
function withLocalTimes(value: unknown, timeZone: string, depth = 0): unknown {
  if (depth > 8 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => withLocalTimes(item, timeZone, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = withLocalTimes(item, timeZone, depth + 1);
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
};

const USER_CONTEXT_INSTRUCTION = 'Datos del usuario leídos al iniciar este trabajo: firma con fullName (y jobTitle y companyName si existen) y redacta con offer, sin consultar profile.get ni app.context para eso. Un valor null no se inventa.';

/** Shared by the worker and AXIS replay. Time comes from the server, not the model. */
export function coworkDecisionContext(
  instructions: ReturnType<typeof coworkAgentInstructions>,
  input: { history: unknown; request: string; observations: unknown[]; mustAnswer: boolean; executionPolicy: unknown; rejectedDecisions?: unknown[];
    userContext?: CoworkUserContext | null },
  now = new Date(),
  timeZone = coworkTimeZone(),
) {
  const observedLeadIds = new Set<string>();
  for (const observation of input.observations) {
    const result = (observation as { result?: { items?: Array<{ lead_id?: string }> } } | null)?.result;
    for (const item of result?.items || []) {
      if (typeof item.lead_id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.lead_id)) observedLeadIds.add(item.lead_id);
    }
  }
  return {
    ...input,
    userContext: input.userContext ? { ...input.userContext, instruction: USER_CONTEXT_INSTRUCTION } : null,
    history: withLocalTimes(input.history, timeZone) as typeof input.history,
    observations: withLocalTimes(input.observations, timeZone) as unknown[],
    contactReadGuidance: {
      observedLeadIds: [...observedLeadIds],
      instruction: input.observations.length === 0
        ? 'Si necesitas descubrir contactos: action contacted.search, query "", leadId null, reads null, plan null. Espera su resultado antes de construir consultas por UUID. Nunca uses referencias, placeholders ni IDs de tareas como UUID.'
        : 'Para cronología usa lead_id observado (no id del registro de envío). Si no está confirmado que el correo esté sincronizado y el usuario pide su correo, gmail.contact_history permite contrastar metadatos de su Gmail; no sincroniza toda la empresa. No repitas la misma fuente para inventar cobertura.',
    },
    // The plan belongs to the first consulting decision (rule 12); repeating it only costs output.
    ...(input.observations.length ? { planStatus: 'El plan ya se mostró: en esta decisión outline es null.' } : {}),
    readBudget: {
      maximum: 3,
      remaining: Math.max(0, 3 - input.observations.reduce<number>((used, item) => {
        const action = (item as { action?: string } | null)?.action;
        return used + (action === 'specialists.review' || action === COWORK_NOTE_ACTION || action === COWORK_PLAN_ACTION ? 0
          : action === 'privacy.contactability_batch' || action === 'lists.review_batch' ? 3 : 1);
      }, 0)),
      instruction: 'No repitas una consulta ya observada en esta ejecución ni en el hilo reciente. Si no está confirmado que el correo esté sincronizado, volver a leer la misma fuente no lo confirma: responde con lo que sabes y el próximo paso disponible.',
    },
    clock: { serverNow: now.toISOString(), timezone: 'UTC', source: 'server', timeZone, localNow: localNow(now, timeZone) },
    glossary: COWORK_GLOSSARY,
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
    threadBudgetCapability: instructions.threadBudgetCapability,
  };
}
