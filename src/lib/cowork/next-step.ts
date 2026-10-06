/**
 * How an answer closes, in one place for the coordinator (rule 4) and the judge. They used
 * to disagree: the coordinator was told to close offering a next step Cowork would take on a
 * «yes», and the judge scored an offered read as friction and sent the answer back, so most
 * judged answers got a correction the person then saw replace the first one.
 */
export const COWORK_NEXT_STEP_RULE = 'La pregunta final ofrece una acción que necesita la aprobación del usuario (crear o activar una campaña, buscar el correo de un contacto, buscar prospectos nuevos, guardar o investigar un contacto, invitar o escribir por LinkedIn) o pide una decisión que solo el usuario puede tomar. Lo que el pedido necesita y puedes hacer ahora sin aprobación (consultar contactos, envíos, respuestas, campañas, métricas o archivos; ordenar, resumir o redactar lo pedido) lo haces en esta respuesta: no lo ofreces como siguiente paso. Las respuestas sugeridas pueden ofrecer otros pedidos distintos.';

/**
 * How the coordinator closes (rule 4, Plan 12): what it can do without approval it does, what the person
 * asked for and needs approval it proposes with its card, and the closing question is only for a next step
 * nobody asked for or a decision that is the person's. The judges keep COWORK_NEXT_STEP_RULE, so the
 * baseline of docs/cowork-plan12-linea-base.md stays comparable.
 */
export const COWORK_CLOSE_RULE = 'El paso que ofrece la pregunta final debe acercar su objetivo (contactos listos, envíos, respuestas, reuniones) y nunca es algo que podías hacer en este turno sin aprobación.';
