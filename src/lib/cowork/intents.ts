/**
 * What a Cowork request is about (Plan 12, 4a), so each turn carries the rules and recipes it needs
 * instead of all of them: the core always goes, and each intent adds its part (agent-instructions.ts).
 * Deterministic and cheap: words of the request and of the previous request in the thread (a «sí,
 * hazlo» continues it). When nothing matches, or the request is long and touches many areas, the
 * whole prompt goes: a missed recipe costs more than a few thousand tokens.
 */

export const COWORK_INTENTS = [
  'help', 'search', 'contacts', 'email', 'linkedin', 'metrics', 'strategy', 'opportunities', 'files', 'agenda', 'replies', 'domain', 'credits', 'crm',
] as const;
export type CoworkIntent = typeof COWORK_INTENTS[number];

const strip = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Patterns on the request without accents, lower case.
const PATTERNS: Array<[CoworkIntent, RegExp]> = [
  ['help', /^(?:hola|buen[oa]s|hey|holi|gracias|ok|okey|vale)\b|que (?:puedes|sabes) hacer|que haces|como funciona|ayuda|que eres|quien eres|para que sirves|soy nuev|tutorial|como (?:uso|se usa)|todo lo que puedes|info(?:rmacion)? (?:en|de) mi perfil|mi perfil|mi web|mi sitio|mi pagina|\b[a-z0-9-]+\.(?:cl|com|io|net|org|ai|co|app)\b/],
  ['search', /busc|prospect|encuentr|leads? nuev|nuevos? (?:leads|contactos|clientes|prospectos)|gerentes? de|jef[ae]s? de|director|cargo|empresas? (?:de|del|que)|rubro|industria|sector|segmento|linkedin\.com\/in|apollo|leads finder|consigue|clientes/],
  ['contacts', /guard|enriquec|investig|contacto|lead|correo de|email de|mail de|lista|ficha|perfil de|quien es|datos de|importa|duplicad/],
  ['email', /correo|email|e-mail|\bmail|secuencia|campana|redact|escrib|mensaje|seguimiento|asunto|plantilla|borrador|firma|envi|remitente|gmail|outlook|version/],
  ['linkedin', /linkedin|invit|conexion|conectar|\bred\b|inmail/],
  ['metrics', /como (?:voy|vamos|me ha ido|me fue|le fue|va)|resultado|metrica|tasa|cifra|numero|informe|reporte|tablero|dashboard|grafic|estadistic|semana|mes\b|mensual|semanal|rendimiento|kpi|pipeline|embudo|funnel|jefe/],
  ['strategy', /icp|cliente ideal|a quien|vender|venta|segment|audiencia|estrateg|por donde (?:parto|empiezo)|ofre[cz]|oferta|propuesta de valor|mercado|priori|recomiend|conviene|vale la pena|plan\b/],
  ['opportunities', /oportunidad|licitaci|compra agil|mercado publico|contratando|ofertas? de (?:trabajo|empleo)|avisos?|seia|proyectos?|chilecompra/],
  // A list of people from an event is usually a file the user uploaded («los de la feria»): without the files part, Cowork asked
  // to attach a list that was already there.
  ['files', /archivo|adjunt|excel|xlsx|csv|pdf|word|docx|subi|planilla|documento que|adjuntos:|descarg|feria|evento|congreso|seminario|webinar|asistentes|listado/],
  ['agenda', /\bhoy\b|pendiente|que (?:toca|hago|me toca)|que queda|agenda|reunion|calendario|manana|esta semana/],
  ['replies', /respond|respuesta|contest|bandeja|hilo|rebot|bounce|interesad|no me (?:ha )?respondido/],
  ['domain', /dominio|entregabilidad|spf|dkim|dmarc|spam|ley|datos personales|cumplimiento|gdpr|baja\b|darse de baja|no contactar/],
  ['credits', /credito|saldo|telefono|celular|whatsapp|cuanto cuesta|costo/],
  ['crm', /crm|pipeline|negocio|etapa|nota|deal|oportunidad de venta|valor del/],
];

// An intent brings the ones its recipes lean on: after a search comes saving; a report reads metrics and campaigns.
const IMPLIES: Partial<Record<CoworkIntent, CoworkIntent[]>> = {
  search: ['contacts'],
  email: ['contacts'],
  linkedin: ['contacts'],
  strategy: ['contacts', 'metrics', 'search'],
  agenda: ['replies', 'email'],
  replies: ['email', 'contacts'],
  metrics: ['email'],
  files: ['contacts'],
  opportunities: ['strategy'],
  crm: ['contacts', 'metrics'],
  credits: ['contacts'],
};

// What a request asks is in its first line: an email or a list pasted after it does not add intents.
const head = (text: string) => {
  const firstLine = text.split('\n')[0];
  const colon = firstLine.indexOf(':');
  return (colon > 20 && colon < 200 ? firstLine.slice(0, colon) : firstLine).slice(0, 240);
};

export function coworkIntentsOf(text: string): Set<CoworkIntent> {
  const normalized = strip(head(text));
  const found = new Set<CoworkIntent>();
  for (const [intent, pattern] of PATTERNS) if (pattern.test(normalized)) found.add(intent);
  return found;
}

/**
 * The intents of a turn, or null for the whole prompt. history is the thread's earlier turns, oldest first;
 * only the previous request counts, so a follow-up keeps the context of what it answers.
 */
export function coworkTurnIntents(request: string, history: Array<{ request?: string | null }> = []): Set<CoworkIntent> | null {
  const own = coworkIntentsOf(request);
  // A short follow-up («sí, hazlo», «el segundo») continues the previous request; a full request stands on its own.
  const followUp = !own.size || request.trim().length < 80;
  const previous = followUp && history.length ? coworkIntentsOf(String(history[history.length - 1]?.request || '')) : new Set<CoworkIntent>();
  const intents = new Set<CoworkIntent>([...own, ...previous]);
  // Nothing recognizable: the whole prompt.
  if (!intents.size) return null;
  for (const intent of [...intents]) for (const implied of IMPLIES[intent] || []) intents.add(implied);
  // A long request that touches most areas gains nothing from routing.
  if (intents.size >= 9) return null;
  return intents;
}

/** True when a part tagged with `tags` goes in a turn with `intents` (null: every part goes). */
export function coworkIntentIncludes(intents: ReadonlySet<CoworkIntent> | null | undefined, tags: readonly CoworkIntent[]) {
  return !intents || tags.some(tag => intents.has(tag));
}

/** Intent prompts are off unless COWORK_INTENT_PROMPTS_ENABLED=true: on 6 oct they cut 22 % of the input but the answers handed more work back (docs/cowork-plan12-ronda-1.md). */
export function coworkIntentPromptsEnabled(env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env) {
  return env.COWORK_INTENT_PROMPTS_ENABLED === 'true';
}
