/**
 * How an answer closes, in one place for the coordinator (rule 4) and the judge. They used
 * to disagree: the coordinator was told to close offering a next step Cowork would take on a
 * «yes», and the judge scored an offered read as friction and sent the answer back, so most
 * judged answers got a correction the person then saw replace the first one.
 */
export const COWORK_NEXT_STEP_RULE = 'La pregunta final ofrece una acción que necesita la aprobación del usuario (crear o activar una campaña, buscar el correo de un contacto, buscar prospectos nuevos, guardar o investigar un contacto, invitar o escribir por LinkedIn) o pide una decisión que solo el usuario puede tomar. Lo que el pedido necesita y puedes hacer ahora sin aprobación (consultar contactos, envíos, respuestas, campañas, métricas o archivos; ordenar, resumir o redactar lo pedido) lo haces en esta respuesta: no lo ofreces como siguiente paso. Las respuestas sugeridas pueden ofrecer otros pedidos distintos.';
