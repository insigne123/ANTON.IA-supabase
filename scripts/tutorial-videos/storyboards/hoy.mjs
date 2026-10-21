import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chileDay, homeScope, thisWeek } from './home-scope.mjs';

const RECORDING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/llamada.m4a');
const DAY = 86_400_000;
const ago = days => new Date(Date.now() - days * DAY).toISOString();
const dueOn = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

// «Llamadas y LinkedIn» and «Para retomar» are answered here: the calls of the day depend on the clock and the script,
// the transcription and the new email are AI. Same shapes as /api/touches and /api/reconnect; made-up people, as in
// demo-data.mjs, matching the conversations of the demo data (contacted-qa-*).
const SUBJECT = company => `${company}: contrataciones sin revisar antecedentes a mano`;
const touch = (id, channel, day, [contactedId, name, company, phone]) => ({
  id, channel, dueAt: ago(0.2), day, manual: false,
  contact: { contactedId, name, role: 'Gerente de Personas', company, email: null, phone: phone || null, tel: phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null,
    linkedin: { href: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${company}`)}`, search: true } },
  firstEmail: { subject: SUBJECT(company), sentAt: ago(day) }, script: null, callSummary: null,
});
const TOUCHES = [
  touch('demo-touch-1', 'call', 3, ['contacted-qa-6', 'Benjamín Silva', 'Grupo Pacífico', '+56 9 8765 4321']),
  touch('demo-touch-2', 'linkedin', 1, ['contacted-qa-7', 'Catalina Morales', 'Constructora Maule']),
  touch('demo-touch-3', 'call', 3, ['contacted-qa-9', 'Valentina Araya', 'Retail Andino', '+56 9 7654 3210']),
];
const SCRIPT = {
  opening: 'Hola Benjamín, soy Camila Torres, de Yago QA. Te escribí la semana pasada sobre cómo revisan antecedentes antes de contratar en Grupo Pacífico. ¿Tienes dos minutos?',
  questions: ['¿Cuántas personas contratan al mes?', '¿Cómo revisan hoy los antecedentes y cuánto demora?', '¿Quién más participa en esa decisión?'],
  voicemail: 'Hola Benjamín, soy Camila Torres, de Yago QA. Te llamaba porque revisamos antecedentes en minutos y no en días. Te escribo de nuevo por correo: búscalo como «Grupo Pacífico: contrataciones sin revisar antecedentes a mano».',
};
const SUMMARY = () => ({
  summary: 'Benjamín contrata unas 60 personas al mes y hoy revisa los antecedentes a mano, con dos personas de su equipo. Quiere acortar esa revisión antes de la temporada alta de diciembre. Decide junto a la gerencia de operaciones.',
  agreements: ['Enviarle una propuesta para 60 contrataciones al mes'],
  nextSteps: [{ text: 'Enviar la propuesta y agendar una demo con operaciones', due: dueOn(2) }],
  objections: ['Quiere saber si se conecta con su sistema de remuneraciones'],
  interest: 'alto', meetingAgreed: true, transcript: '', durationSeconds: 245, createdAt: new Date().toISOString(),
});
const REMINDERS = [
  { contactedId: 'contacted-qa-4', leadId: null, name: 'Joaquín Díaz', company: 'Farmacias Del Valle', kind: 'closed',
    reason: 'Cerraron sin acuerdo hace 64 días: te pidió escribirle más adelante.', lastContactAt: ago(64), daysSince: 64 },
  { contactedId: 'contacted-qa-13', leadId: null, name: 'Martina Valenzuela', company: 'Transportes Cordillera', kind: 'signal',
    reason: 'Transportes Cordillera está contratando: «Analista de reclutamiento». Hablaron hace 35 días.', lastContactAt: ago(35), daysSince: 35,
    signal: { kind: 'hiring', title: 'Analista de reclutamiento' } },
];
let done = new Set();
let scripted = new Set();

// «Meta de la semana» and «Contacto del día» read the clock and tables the bench has no rows in: same shapes as
// GET /api/weekly-goals and /api/lead-drops/latest.
const GOAL = { targets: { contacted: 10, found: 15 }, counts: { contacted: 6, found: 11 }, source: 'team' };

export default {
  id: 'hoy', title: 'Hoy', start: '/dashboard',
  // Nine scenes: a little more compression keeps it under the 4 MB the help serves.
  crf: 31,
  intro: 'Tu punto de partida cada día: lo más importante primero, tus llamadas y LinkedIn, a quién volver a escribir y tu meta de la semana.',
  learn: ['Ver lo más urgente', 'Llamar con un guion y dejar el resumen en el CRM', 'Tu meta y tu contacto del día'],
  mocks: [
    {
      // «Tu resumen de hoy» is one sentence on a day with nothing yet (and the bench has no activity of its own): a day of work,
      // same shape as GET /api/home/summary, so the four figures and the chart are what the video talks about.
      url: '**/api/home/summary', method: 'GET',
      respond: (_body, request) => ({ scope: homeScope(request), sent: 7, contacted: 6, replied: 2, saved: 3, automaticReplies: 0, unclassifiedReplies: 0, partial: false,
        activity: [{ hour: '08:00', sent: 2, replied: 0 }, { hour: '09:00', sent: 3, replied: 1 }, { hour: '10:00', sent: 2, replied: 1 }] }),
    },
    { url: '**/api/weekly-goals', method: 'GET', respond: (_body, request) => ({ scope: homeScope(request), week: thisWeek(), goal: GOAL, ready: 4, admin: true }) },
    {
      url: '**/api/lead-drops/latest', method: 'GET',
      respond: (_body, request) => ({ scope: homeScope(request), pull: null, drop: { id: '00000000-0000-4000-8000-000000000901', dropDate: chileDay(), total: 1, left: 1,
        next: { name: 'Fernanda Rojas', company: 'Retail Austral', why: 'Calza con tu cliente ideal por su cargo y su rubro (retail), en Santiago.' } } }),
    },
    {
      url: /\/api\/touches$/, method: 'GET',
      respond: () => ({ available: true, cadence: { call: { on: true, day: 3 }, linkedin: { on: true, day: 1 }, since: dueOn(-30) },
        touches: TOUCHES.filter(item => !done.has(item.id)).map(item => (scripted.has(item.id) ? { ...item, script: SCRIPT } : item)),
        waiting: 0, doneToday: 0, writesToPeople: true }),
    },
    {
      url: /\/api\/touches\/[^/]+$/, method: 'POST',
      respond: (body, request) => {
        const id = new URL(request.url()).pathname.split('/').pop();
        if (body?.action === 'script') { scripted.add(id); return { script: SCRIPT }; }
        done.add(id);
        return { id, state: body?.action === 'skip' ? 'skipped' : 'done' };
      },
    },
    {
      url: /\/api\/touches\/[^/]+\/recording$/, method: 'POST',
      respond: (_body, request) => { done.add(new URL(request.url()).pathname.split('/').at(-2)); return { summary: SUMMARY(), crm: true }; },
    },
    { url: /\/api\/reconnect$/, method: 'GET', respond: () => ({ alerts: REMINDERS, total: REMINDERS.length, afterDays: 60, canPostpone: true }) },
  ],
  scenes: [
    {
      title: 'Lo primero, siempre arriba', text: 'Una sola acción: la más importante ahora.',
      say: '«Hoy» te dice qué hacer primero.',
      before: async () => { done = new Set(); scripted = new Set(); },
      target: { role: 'link', name: 'Abrir conversación' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Contacto del día', text: 'Martes, miércoles y viernes, un contacto nuevo con correo verificado, elegido para ti.',
      say: 'Martes, miércoles y viernes te espera un contacto nuevo.', postit: 'Guardarlo no gasta créditos: ya trae su correo.',
      target: { role: 'link', name: 'Ver y guardar' }, zoomOn: { text: 'Contacto del día' }, action: 'hover', zoom: 1.3, arrow: true,
    },
    {
      title: 'Lo que te espera', text: 'Respuestas, compromisos y contactos listos, de lo más urgente a lo menos.',
      say: 'Debajo, lo que te espera, en orden de urgencia.',
      target: { role: 'link', name: /Matías Rojas/, exact: false }, action: 'hover', zoom: 1.4, arrow: true,
    },
    {
      title: 'Llamadas y LinkedIn', text: 'A quien no respondió tu correo: una llamada o LinkedIn, el día que elegiste.',
      say: 'Si no te respondieron, te toca llamar o escribir por LinkedIn.', postit: 'Con «Ajustar» eliges el día y si quieres llamadas, LinkedIn o ambos.',
      target: { css: '[aria-labelledby="touches-title"]' }, action: 'none', zoom: 1.25,
    },
    {
      title: 'Qué decir', text: 'La IA prepara la apertura, tres preguntas y el mensaje si no contesta.',
      say: 'Pide el guion antes de llamar.',
      target: { role: 'button', name: 'Guion y resultado' }, zoom: 1.5, arrow: true,
      waitFor: { text: 'Al contestar' },
    },
    {
      title: 'El guion', text: 'Nombra tu correo para que la persona lo encuentre.',
      say: 'Así abres la llamada, y esto le preguntas.',
      target: { text: 'Al contestar' }, zoomOn: { text: 'Para entender si le sirve' }, action: 'none', zoom: 1.3,
    },
    {
      title: '¿Qué pasó?', text: 'Hablaron, dejaste mensaje o no contestó: un clic.',
      say: 'Después de llamar, cuenta qué pasó.',
      target: { role: 'button', name: 'Hablamos' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'button', name: 'Subir grabación' },
    },
    {
      title: 'Sube la grabación', text: 'La transcribimos y la resumimos. El audio no se guarda.',
      say: 'Si la grabaste, súbela.', postit: 'Pide permiso para grabar al empezar la llamada.',
      target: { role: 'button', name: 'Subir grabación' }, upload: RECORDING, zoom: 1.6, arrow: true,
      waitFor: { text: /Resumen de la llamada guardado en el CRM/, exact: false },
    },
    {
      title: 'El resumen, en el CRM', text: 'Lo que dijo, el interés y el próximo paso con fecha, en la ficha del lead.',
      say: 'El resumen y el próximo paso quedan en el CRM.',
      target: { text: /Resumen de la llamada guardado en el CRM/, exact: false }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Para retomar', text: 'A quién vale la pena volver a escribir, y por qué ahora.',
      say: 'Y a quién conviene volver a escribir.', postit: '«Retomar» prepara un correo con un ángulo nuevo para que lo revises.',
      target: { role: 'button', name: 'Retomar con Martina Valenzuela' }, zoomOn: { css: '[aria-labelledby="reconnect-title"]' }, action: 'hover', zoom: 1.25, arrow: true,
    },
    {
      title: 'Tu meta de la semana', text: 'A cuántas personas contactar y cuántos contactos nuevos con correo sumar, y si vas al día.',
      say: 'Y tu meta: cuánto llevas y qué te falta hoy.', postit: 'Quien administra el equipo la cambia en «Tu semana».',
      target: { css: '[data-tour="weekly-goal"]' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Tu resumen de hoy', text: 'Correos enviados, contactos, respuestas y guardados de hoy, solo tuyos.',
      say: 'Y tu día, en cuatro cifras.', postit: 'Cada cifra abre la lista que la explica.',
      target: { role: 'link', name: /^Correos enviados hoy/, exact: false }, zoomOn: { css: 'section[aria-labelledby="summary-title"]' }, action: 'hover', zoom: 1.3, arrow: true,
    },
    {
      title: 'Abre lo urgente', text: 'Un clic y estás en la conversación, lista para responder.',
      say: 'Abre la conversación y respóndele.',
      target: { role: 'link', name: 'Abrir conversación' }, zoom: 1.3,
      waitFor: { role: 'heading', name: 'Conversaciones' },
    },
  ],
  outro: { title: 'Empieza aquí cada día', text: 'Lo urgente arriba, lo demás en orden.', items: ['Una acción principal', 'Llamadas y LinkedIn con guion', 'Tu meta y contactos nuevos dos veces por semana'] },
};
