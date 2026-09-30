// Replies a prospect could send after a cold email, labeled with the intents the app's reply
// classifier uses (src/lib/reply-classifier.ts). Fictional and anonymized: the reply lab's
// scenarios plus the patterns of a real B2B operation (objections, referrals, unsubscribes,
// out-of-office notes and bounces). Only clear cases: an ambiguous reply does not measure anything.
import { DEFAULT_REPLY_SAFETY_SCENARIOS } from '../../src/lib/antonia-reply-lab';
import type { ReplyClassification } from '../../src/lib/reply-classifier';

export type ReplyIntentSample = { id: string; text: string; intent: Exclude<ReplyClassification['intent'], 'unknown'> };

const LAB: ReplyIntentSample[] = DEFAULT_REPLY_SAFETY_SCENARIOS.map(scenario => ({
  id: `lab-${scenario.id}`, text: scenario.replyText, intent: scenario.classification.intent as ReplyIntentSample['intent'],
})).filter(sample => sample.intent !== ('unknown' as string));

export const REPLY_INTENT_SAMPLES: ReplyIntentSample[] = [
  ...LAB,
  { id: 'agendar-jueves', text: '¿Te parece agendar una llamada el jueves a las 10?', intent: 'meeting_request' },
  { id: 'interes-horarios', text: 'Sí, con interés. ¿Qué horarios tienes la próxima semana?', intent: 'meeting_request' },
  { id: 'disponibilidad', text: 'Hola, sí me interesa ver cómo funciona. Mándame tu disponibilidad.', intent: 'meeting_request' },
  { id: 'manana-16', text: 'Excelente, ¿podemos verlo mañana a las 16:00?', intent: 'meeting_request' },
  { id: 'compartir-equipo', text: 'Lo compartiré con mi equipo para agendar una reunión. Te aviso.', intent: 'positive' },
  { id: 'deriva-jefa', text: 'Me parece interesante, pero quien ve este tema es nuestra jefa de selección, Paula. Te la copio.', intent: 'positive' },
  { id: 'deriva-gerente', text: 'Te derivo con nuestro gerente general, que es quien decide estas herramientas.', intent: 'positive' },
  { id: 'precio-persona', text: 'Interesante, ¿cuánto cuesta por persona consultada?', intent: 'positive' },
  { id: 'cotizacion', text: 'Sí, envíame la cotización para unas 4.000 consultas mensuales.', intent: 'positive' },
  { id: 'resuelto', text: 'Gracias, pero lo tenemos resuelto a plena satisfacción con nuestro proveedor actual.', intent: 'negative' },
  { id: 'otra-herramienta', text: 'Ya usamos otra herramienta para eso, gracias.', intent: 'negative' },
  { id: 'no-interesados', text: 'No estamos interesados, gracias.', intent: 'negative' },
  { id: 'plata', text: 'Cuando se habla de plata no gusta. Por ahora no.', intent: 'negative' },
  { id: 'ia-corporativa', text: 'Tenemos IA corporativa, no necesitamos más suscripciones.', intent: 'negative' },
  { id: 'apps-propias', text: 'Trabajamos con aplicaciones propias, así que no aplica para nosotros.', intent: 'negative' },
  { id: 'prioridad-marzo', text: 'No es prioridad ahora, quizás en marzo.', intent: 'neutral' },
  { id: 'fiestas-patrias', text: 'Escríbeme después de fiestas patrias, ahora estamos a full.', intent: 'neutral' },
  { id: 'multiriesgo', text: '¿Es una plataforma multiriesgo o solo revisa causas judiciales?', intent: 'neutral' },
  { id: 'licencias', text: '¿Cubre también la revisión de licencias de conducir?', intent: 'neutral' },
  { id: 'caso-construccion', text: '¿Tienen algún caso de uso en el rubro construcción?', intent: 'neutral' },
  { id: 'evaluando', text: 'Ya le respondí a tu colega la semana pasada, lo estamos evaluando.', intent: 'neutral' },
  { id: 'presupuesto', text: 'Por ahora no tenemos presupuesto, contáctame el próximo año.', intent: 'neutral' },
  { id: 'eliminar-base', text: 'Por favor elimínenme de su base de datos.', intent: 'unsubscribe' },
  { id: 'no-escribir', text: 'No me vuelvan a escribir.', intent: 'unsubscribe' },
  { id: 'dar-baja', text: 'Dar de baja.', intent: 'unsubscribe' },
  { id: 'vacaciones', text: 'Estaré de vacaciones hasta el 14 de octubre, sin acceso al correo. Para temas urgentes escribir a recepcion@empresa.cl.', intent: 'auto_reply' },
  { id: 'out-of-office', text: 'Out of office: I will be back on Monday.', intent: 'auto_reply' },
  { id: 'casilla', text: 'Gracias por su correo. Esta casilla no es monitoreada.', intent: 'auto_reply' },
  { id: 'licencia-medica', text: 'Me encuentro con licencia médica hasta el 3 de noviembre.', intent: 'auto_reply' },
  { id: 'dsn', text: 'Delivery Status Notification (Failure). Address not found: your message wasn\'t delivered to the address because it couldn\'t be found.', intent: 'delivery_failure' },
  { id: 'mailbox-unavailable', text: 'Mail delivery failed: returning message to sender. 550 mailbox unavailable.', intent: 'delivery_failure' },
];
