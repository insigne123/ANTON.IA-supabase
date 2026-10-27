// What the worker writes as the request of the turn that resumes a conversation on its own, after something the person approved
// finished (server/cowork/effects.ts and external-search.ts). The task bench (scripts/evaluate-cowork-tasks.ts) resumes with the same words.

/** After an approved external search completed. */
export const COWORK_CONTINUE_AFTER_SEARCH = 'Continúa a partir del resultado de búsqueda completado del trabajo anterior, dentro del mismo encargo. Si result.strategy es profile, presenta a la persona de ese perfil exacto y conserva el encargo original: propone guardarla y, después de guardarla, preparar la invitación o mensaje solicitado; no pidas su empresa ni muestres a otras personas. Si no fue un perfil exacto, presenta lo encontrado agrupado por empresa: cuántas personas y empresas trajo, quiénes parecen decidir la compra según su cargo (role y fit, que son hipótesis) y cualquier aviso (notice). Propón el siguiente paso concreto, por ejemplo guardar a los adecuados en un solo lote. Si result.next no es null, ofrece «Traer más» como respuesta sugerida; al pedirlo, propones los mismos criterios con page y offset de result.next. No repitas la búsqueda externa: ya está completada y su resultado está en el historial.';

/** After the plan of a long task was approved: the task starts by its first step, without asking again. */
export const COWORK_CONTINUE_AFTER_PLAN = 'El usuario aprobó el plan de la tarea (task). Empieza ahora por su primer paso pendiente, sin volver a preguntar.';

/** After a batch of contacts was prepared: its people are the people of this work, shown by what the batch returned, never searched again by name. */
export const COWORK_CONTINUE_AFTER_BATCH = 'Continúa a partir del lote recién ejecutado, dentro del mismo encargo. Presenta su resultado en un bloque table con esas mismas personas (nombre real, correo y su estado, LinkedIn, investigación), tomado del resultado del lote en history.actions, sin buscarlas de nuevo por nombre; di en una frase qué faltó y por qué, y propón el siguiente paso concreto sin repetir el lote.';

/** After any other approved effect. */
export const COWORK_CONTINUE_AFTER_EFFECT = 'Continúa a partir del efecto recién ejecutado, dentro del mismo encargo. Resume qué quedó hecho y propón el siguiente paso concreto sin repetir el efecto.';

/** The request that resumes the conversation after an effect of this kind finished. */
export function coworkContinuationAfter(kind: string) {
  if (kind === 'task_plan') return COWORK_CONTINUE_AFTER_PLAN;
  if (kind === 'lead_prepare_batch') return COWORK_CONTINUE_AFTER_BATCH;
  return COWORK_CONTINUE_AFTER_EFFECT;
}

/** After a delivery inside an approved task (with its graph), the next pending step: the worker resumes the task on its own. */
export function coworkContinueTask(nextStep: string) {
  return `Continúa la tarea aprobada desde su entrega guardada. Siguiente paso: ${nextStep}. Conserva los targets, la oferta y la versión exacta; no repitas lo ya completado ni amplíes permisos o gasto.`;
}
