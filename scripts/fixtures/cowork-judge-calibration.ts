// Answers people already read and scored (docs/cowork-evaluacion-transcripciones-2026-09-25.md):
// real production turns of 25 sep 2026, quoted as they were recorded (the «…» are in the
// record). The judge is calibrated against these scores before its grades are trusted.
// Scale 1-5; the record's F (formato/claridad) is claridad and R is fricción (5 = none).
import type { CoworkJudgeDimension } from '../../src/lib/cowork/judge';

export type CoworkJudgeCalibrationCase = {
  id: string;
  run: string;
  request: string;
  /** What Cowork had consulted, as the record describes it. */
  facts: string;
  reply: string;
  human: Record<CoworkJudgeDimension, number>;
  note: string;
};

export const JUDGE_CALIBRATION: CoworkJudgeCalibrationCase[] = [
  { id: 'pendientes-vacio', run: '3e143ba7', request: 'hola, que tengo pendiente para hoy?',
    facts: 'contacted.search devolvió 0 ítems; replies.attention sin pendientes. La cuenta tiene 255 contactos guardados, 19 campañas y 2 incidencias abiertas, que no consultó.',
    reply: '¡Hola! En los registros de la app no aparecen contactos ni respuestas pendientes; la lista consultada está vacía. Pero la cobertura de Gmail y Outlook no está verificada, así que no puedo confirmar que no haya mensajes por atender en tus buzones. Si esperabas algo en particular, habría que comprobar el hilo en el correo conectado.',
    human: { comprension: 4, veracidad: 4, utilidad: 2, claridad: 3, friccion: 2 },
    note: 'Callejón sin salida; jerga («cobertura», «hilo en el correo conectado»).' },
  { id: 'metricas-semana', run: '1c86e476', request: 'como me ha ido esta semana con los correos? dame numeros',
    facts: 'metrics.overview y metrics.rates: últimos 7 días 0 envíos, 0 respuestas humanas, 0 respuestas automáticas y 0 rebotes; tasas sin denominador; 255 contactos guardados; la cobertura de Gmail y Outlook figura como desconocida.',
    reply: 'En los registros de la app, en los últimos 7 días: 0 correos enviados, 0 respuestas humanas, 0 automáticas y 0 rebotes. Con 0 envíos registrados, las tasas no se pueden calcular (no equivalen a 0%). Hay 255 contactos guardados, pero eso no significa que se les haya escrito. La cobertura de Gmail y Outlook figura como desconocida, así que queda por comprobar si estos números reflejan todo tu correo.',
    human: { comprension: 5, veracidad: 5, utilidad: 3, claridad: 4, friccion: 3 },
    note: 'Números correctos; sin comparación con 30 días ni siguiente paso.' },
  { id: 'dominio', run: '0bf28439', request: 'revisa si mi dominio esta bien configurado pa no caer en spam',
    facts: 'Sin consultas. El perfil del usuario tiene el correo en yago.cl, así que el dominio se podía deducir.',
    reply: 'Pásame el dominio desnudo (por ejemplo, ejemplo.cl) y revisaré sus registros MX, SPF, DKIM y DMARC. La comprobación de DKIM puede quedar como desconocida…',
    human: { comprension: 4, veracidad: 5, utilidad: 1, claridad: 2, friccion: 1 },
    note: 'Pide algo que podía deducir; «dominio desnudo» es jerga.' },
  { id: 'vale-la-pena', run: '92655919', request: 'y que sabemos de la nehal de adecco? vale la pena escribirle?',
    facts: 'leads.search: Nehal, Recruitment Manager en Adecco, sin correo. compliance.check: bloqueado por falta de correo. research.get_existing: sin investigación. La oferta del usuario llegó rota («[object Object]»).',
    reply: 'Nehal figura como Recruitment Manager de Adecco… no tiene correo registrado. No hay investigación guardada y la revisión de cumplimiento bloquea el contacto por falta de email. ¿Vale la pena escribirle? Es una posibilidad… no sabemos si tiene el problema que resolvemos… No la priorizaría… ¿Qué necesidad específica de reclutamiento buscas abordar con Adecco?',
    human: { comprension: 4, veracidad: 4, utilidad: 2, claridad: 3, friccion: 2 },
    note: 'No propone buscar el correo; pregunta qué vende; jerga interna.' },
  { id: 'campana-proveedor', run: '0f4f116d', request: 'me gustan, dale creala',
    facts: 'Dos turnos antes el usuario pidió una campaña de prueba de 3 correos solo para su contacto de prueba, a quien Cowork llamó Nico por su correo; los correos se acordaron en el turno anterior. app.context: Gmail y Outlook conectados, dominio en Google Workspace. campaigns.list consultado.',
    reply: 'Para proponer la campaña solo para Nico necesito elegir el proveedor de correo. Gmail y Outlook aparecen conectados… ¿La preparo con Gmail o con Outlook?',
    human: { comprension: 5, veracidad: 5, utilidad: 3, claridad: 4, friccion: 2 },
    note: 'Podía proponer con Gmail y dejar el cambio en la tarjeta.' },
  { id: 'agendar-reunion', run: '0fb9915d', request: 'agendame una reunion con carlos de minera centinela para el martes a las 10',
    facts: 'contacted.search, leads.search (Carlos de Minera Centinela, sin correo) y contacted.timeline. Cowork no tiene calendario.',
    reply: 'No puedo agendarla desde aquí: no tengo una herramienta de calendario. … La cobertura del buzón no está verificada… ¿Te refieres al martes 29 de septiembre a las 10:00, y en qué zona horaria?',
    human: { comprension: 4, veracidad: 5, utilidad: 2, claridad: 3, friccion: 2 },
    note: 'Honesto con el límite, pero pregunta fecha y zona para algo que no hará.' },
  { id: 'linkedin-seguimiento', run: '18436ca1', request: 'a quien le deberia hacer seguimiento por linkedin esta semana?',
    facts: 'linkedin.followups sin candidatos elegibles; linkedin.inbox con barrido incompleto.',
    reply: '…no aparecen candidatos elegibles… El barrido de la bandeja está incompleto… Antes de hacer seguimientos, completa el barrido y vuelve a revisar…',
    human: { comprension: 4, veracidad: 4, utilidad: 1, claridad: 3, friccion: 1 },
    note: '«barrido» es jerga; no dice cómo completarlo ni ofrece alternativa.' },
];
