/** What the person reads when a Cowork turn cannot finish. Internal errors
 * never reach the screen: each known cause maps to a plain sentence that says
 * what happened and what to do next. Unknown causes keep a neutral message. */

const GENERIC = 'No pude completar esta respuesta. Tu solicitud quedó guardada: reintenta o reformúlala.';

type Rule = { category: string; test: (error: Error & { status?: number; feedback?: string; userFacing?: boolean }) => boolean; message: (error: Error & { feedback?: string }) => string };

const RULES: Rule[] = [
  { category: 'proposal_rejected', test: error => error.name === 'CoworkDecisionRejected' && error.userFacing === true && typeof error.feedback === 'string',
    message: error => `${String(error.feedback).replace(/^La propuesta no se pudo preparar:\s*/i, 'No pude preparar la acción: ').slice(0, 280)}` },
  { category: 'decision_rejected', test: error => error.name === 'CoworkDecisionRejected',
    message: () => 'No logré armar una respuesta válida después de varios intentos. Tu solicitud quedó guardada: reintenta o dame un poco más de detalle.' },
  // The automatic chain stops after a few actions in a row; a message from the person starts a new one in this same conversation.
  { category: 'thread_effect_budget', test: error => /Thread effect budget exhausted/.test(error.message),
    message: () => 'Hice varias acciones seguidas sin tu confirmación y paré aquí. Escríbeme para seguir: retomo en esta misma conversación.' },
  { category: 'thread_search_budget', test: error => /Thread search budget exhausted/.test(error.message),
    message: () => 'Ya hice las búsquedas que puedo sin tu confirmación. Escríbeme si quieres buscar más y sigo en esta misma conversación.' },
  { category: 'search_quota', test: error => /Daily search quota exhausted|Search quota exhausted/.test(error.message),
    message: () => 'Se acabaron las búsquedas externas de hoy. La cuota se renueva mañana.' },
  { category: 'search_disabled', test: error => /External search disabled/.test(error.message),
    message: () => 'La búsqueda de prospectos nuevos está desactivada en esta cuenta.' },
  // The cap of the day per person (Santiago time), the guard of a whole conversation, and the cap of a single answer.
  { category: 'model_budget_daily', test: error => /COWORK_DAILY_MODEL_BUDGET/.test(error.message),
    message: () => 'Llegaste al uso diario del asistente. Se renueva a medianoche, hora de Chile; lo que hicimos quedó guardado y mañana sigo desde aquí.' },
  { category: 'model_budget_conversation', test: error => /COWORK_CONVERSATION_MODEL_BUDGET/.test(error.message),
    message: () => 'Esta conversación llegó a su máximo de uso del asistente. Lo hecho quedó guardado: escríbeme en una conversación nueva y retomo con lo que necesites de esta.' },
  { category: 'model_budget', test: error => /reservar presupuesto/.test(error.message),
    message: () => 'Esta respuesta usó todo lo que puedo en un solo paso. Escríbeme «sigue» y continúo desde aquí, en esta misma conversación.' },
  { category: 'model_timeout', test: error => error.name === 'TimeoutError' || /timed out/i.test(error.message),
    message: () => 'El asistente tardó demasiado en responder. Tu solicitud quedó guardada: reintenta en un momento.' },
  // An account without credits is not a busy service: retrying in a minute does not help, and it is not the person's request.
  { category: 'model_quota', test: error => /(?:OPENAI|GLM)_HTTP_4\d\d/.test(error.message) && /insufficient_quota|credit_balance_exhausted|billing_hard_limit|exceeded your current quota/i.test(error.message),
    message: () => 'El servicio de IA no está disponible por un problema de la cuenta de ANTON.IA con su proveedor, no por tu solicitud, y reintentar ahora no lo resuelve. Tu solicitud quedó guardada: avisa a soporte de ANTON.IA y reintenta cuando te confirmen que volvió.' },
  { category: 'model_rate_limit', test: error => /(?:OPENAI|GLM)_HTTP_429/.test(error.message),
    message: () => 'El servicio de IA está saturado. Reintenta en un minuto.' },
  { category: 'model_unavailable', test: error => /(?:OPENAI|GLM)_HTTP_5\d\d/.test(error.message),
    message: () => 'El servicio de IA no respondió. Reintenta en un momento.' },
  { category: 'access', test: error => error.name === 'AuthError' || error.status === 401 || error.status === 403,
    message: () => 'Ya no tienes acceso a este trabajo en este workspace.' },
  { category: 'cancelled', test: error => error.name === 'AbortError',
    message: () => 'El trabajo se detuvo antes de terminar. Lo consultado hasta aquí quedó guardado.' },
];

function asError(error: unknown) {
  return (error instanceof Error ? error : new Error(String(error ?? ''))) as Error & { status?: number; feedback?: string; userFacing?: boolean };
}

export function coworkFailureCategory(error: unknown): string {
  const value = asError(error);
  return RULES.find(rule => rule.test(value))?.category || 'unknown';
}

export function coworkFailureMessage(error: unknown): string {
  const value = asError(error);
  const rule = RULES.find(item => item.test(value));
  return rule ? rule.message(value) : GENERIC;
}
