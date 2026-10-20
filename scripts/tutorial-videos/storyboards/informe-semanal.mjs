import { homeScope, thisWeek } from './home-scope.mjs';

const DAY = 86_400_000;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

// The report is answered here, not read from the demo data: a video recorded on a Monday would otherwise show an empty
// «Esta semana». Same shape as GET /api/weekly-report (src/lib/weekly-report.ts); made-up people and bodies, as in
// demo-data.mjs and oportunidades-data.mjs.
const chileDay = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(at);
const shift = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const label = (start, end) => {
  const part = (day, month) => `${Number(day.slice(8, 10))}${month ? ` ${MONTHS[Number(day.slice(5, 7)) - 1]}` : ''}`;
  return start.slice(5, 7) === end.slice(5, 7) ? `${part(start, false)}–${part(end, true)}` : `${part(start, true)} – ${part(end, true)}`;
};

function week(which) {
  const today = chileDay(new Date());
  const monday = shift(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - (which === 'previous' ? 7 : 0));
  const end = shift(monday, 6);
  const from = `${monday}T03:00:00.000Z`;
  return { which, start: monday, end, from, to: which === 'previous' ? `${shift(monday, 7)}T03:00:00.000Z` : new Date().toISOString(),
    previousFrom: `${shift(monday, -7)}T03:00:00.000Z`, previousTo: from, label: label(monday, end) };
}

const ago = days => new Date(Date.now() - days * DAY).toISOString();
const ahead = days => new Date(Date.now() + days * DAY).toISOString();

// The team's weekly goal (src/lib/weekly-goals.ts): what each person did against it, this week and the last.
const goal = (contacted, found) => ({ targets: { ...team }, counts: { contacted, found }, source: 'team' });

function report(which) {
  const current = which === 'current';
  return {
    week: week(which), roles: ['personal', 'team', 'opportunities'], name: 'Camila',
    goal: current ? goal(6, 11) : goal(12, 16),
    personal: {
      sent: current ? { now: 24, before: 15 } : { now: 31, before: 26 }, contacted: current ? { now: 21, before: 14 } : { now: 28, before: 22 },
      replies: current ? { now: 5, before: 2 } : { now: 6, before: 4 }, meetings: current ? 1 : 2,
      pending: [
        { id: 'contacted-qa-1', name: 'Andrea Soto', company: 'Retail Andino', repliedAt: ago(1) },
        { id: 'contacted-qa-2', name: 'Matías Rojas', company: 'Logística Sur', repliedAt: ago(2) },
      ],
      commitments: [{ id: 'contacted-qa-1', name: 'Andrea Soto', company: 'Retail Andino', title: 'Demo con su ATS', dueAt: ahead(2) }],
      touches: { calls: 4, linkedin: 6 },
    },
    team: {
      members: [
        { userId: 'demo-owner', name: 'Camila Torres', role: 'owner', sent: 24, replies: 5, meetings: 1, pending: 2, goal: current ? goal(6, 11) : goal(12, 16) },
        { userId: 'demo-member', name: 'Diego Fuentes', role: 'member', sent: 0, replies: 1, meetings: 0, pending: 1, goal: current ? goal(3, 4) : goal(5, 9) },
        // Someone who did nothing in the week: counted in one line under the table, not as a row of zeros.
        { userId: 'demo-member-2', name: 'Tomás Rivas', role: 'member', sent: 0, replies: 0, meetings: 0, pending: 0, goal: goal(0, 0) },
      ],
      totals: { sent: { now: 24, before: 29 }, replies: { now: 6, before: 4 }, meetings: 1 },
    },
    opportunities: {
      found: { total: 14, recommended: 4, byKind: [{ kind: 'tender', label: 'Licitaciones', count: 8 }, { kind: 'compra_agil', label: 'Compras Ágiles', count: 4 }, { kind: 'hiring', label: 'Empresas contratando', count: 2 }] },
      closing: [
        { id: 'demo-op-1', kind: 'tender', title: 'Servicio de verificación de antecedentes de postulantes', buyer: 'Hospital Regional de Bahía Azul', deadlineAt: ahead(3), amount: 48000000, currency: 'CLP', assigned: true },
        { id: 'demo-op-2', kind: 'compra_agil', title: 'Evaluaciones psicolaborales para 40 cargos', buyer: 'Municipalidad de Valle Verde', deadlineAt: ahead(5), amount: 6500000, currency: 'CLP', assigned: false },
      ],
      unassignedClosing: 1, won: 1, lost: 0,
    },
  };
}

const MEMBERS = [
  { userId: 'demo-owner', name: 'Camila Torres', email: 'camila.torres@yago-qa.cl' },
  { userId: 'demo-member', name: 'Diego Fuentes', email: 'diego.fuentes@yago-qa.cl' },
  { userId: 'demo-member-2', name: 'Tomás Rivas', email: 'tomas.rivas@yago-qa.cl' },
];
let emailOn = false;
let alertsOn = true;
let team = { contacted: 10, found: 15 };

export default {
  id: 'informe-semanal', title: 'Informe semanal', start: '/dashboard',
  intro: 'Cómo te fue en la semana, tu meta, qué te espera y qué hacer primero. Si administras, también tu equipo y Oportunidades.',
  learn: ['Leer tu semana en una frase y tu meta', 'Ver a tu equipo, sus metas y lo que cierra pronto', 'Recibirlo cada lunes y avisos en la semana'],
  mocks: [
    {
      url: '**/api/weekly-report?*', method: 'GET',
      respond: (_body, request) => ({ report: report(new URL(request.url()).searchParams.get('week') === 'previous' ? 'previous' : 'current'),
        email: emailOn, alerts: alertsOn, mailbox: 'google', managers: [], members: MEMBERS }),
    },
    {
      // «Meta de la semana» in «Hoy», and the editor of «Metas del equipo» (?settings=1). Same shapes as /api/weekly-goals.
      url: /\/api\/weekly-goals(\?.*)?$/, method: 'GET',
      respond: (_body, request) => ({ scope: homeScope(request), week: thisWeek(), goal: goal(6, 11), ready: 4, admin: true,
        ...(new URL(request.url()).searchParams.get('settings') === '1' ? { settings: { team, people: [], members: MEMBERS } } : {}) }),
    },
    { url: /\/api\/weekly-goals$/, method: 'POST', respond: body => { team = { ...body.team }; return { team, people: body.people || [] }; } },
    {
      url: '**/api/weekly-report', method: 'POST',
      respond: body => {
        if (body?.action === 'email') { emailOn = Boolean(body.on); return { email: emailOn }; }
        if (body?.action === 'alerts') { alertsOn = Boolean(body.on); return { alerts: alertsOn }; }
        if (body?.action === 'managers') return { managers: body.userIds || [] };
        return { to: 'camila.torres@yago-qa.cl', week: body?.week || 'current' };
      },
    },
  ],
  scenes: [
    {
      title: 'Abre «Tu semana»', text: 'Está en «Hoy», arriba a la derecha: tu informe semanal.',
      say: 'En Hoy, abre Tu semana.',
      before: async () => { emailOn = false; alertsOn = true; team = { contacted: 10, found: 15 }; },
      target: { role: 'button', name: 'Tu semana', within: { role: 'group', name: 'Vista de Hoy' } }, zoom: 1.6, arrow: true,
      waitFor: { role: 'heading', name: 'Tu semana' },
    },
    {
      title: 'Tu semana en una frase', text: 'A cuántas personas escribiste, cuántas respondieron y quién pidió reunión.',
      say: 'Arriba, tu semana en una frase.',
      target: { text: /^Esta semana escribiste/, exact: false }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Cuatro cifras', text: 'Cada una contra los mismos días de la semana anterior.',
      say: 'Y cuatro cifras, con su cambio.', postit: 'Las respuestas se cuentan como % de las personas a las que escribiste.',
      // The cards themselves: «Personas contactadas» is also a row of the goal, above them.
      target: { css: 'div.grid.grid-cols-2.sm\\:grid-cols-4' }, zoomOn: { text: 'Reuniones pedidas' }, action: 'none', zoom: 1.2,
    },
    {
      title: 'Tu meta de la semana', text: 'Personas contactadas y contactos nuevos con correo: cuánto llevas y si vas al día.',
      say: 'Tu meta de la semana, y lo que te falta hoy para ir al día.', postit: 'Contactar cuenta un correo, un mensaje de LinkedIn o una llamada.',
      target: { role: 'heading', name: 'Meta de la semana' }, zoomOn: { css: '[aria-labelledby="weekly-goal-title"]' }, action: 'none', zoom: 1.3, arrow: true,
    },
    {
      title: 'Para esta semana', text: 'Hasta tres acciones, en orden: responder primero, después tus compromisos.',
      say: 'Lo que conviene hacer primero, con un clic.',
      target: { role: 'link', name: /^Responde a/, exact: false }, action: 'hover', zoom: 1.45, arrow: true,
    },
    {
      title: 'Te esperan', text: 'Quién te respondió y sigue esperando, con la misma regla que «Por responder».',
      say: 'Quién te escribió y espera tu respuesta.',
      target: { role: 'heading', name: 'Te esperan' }, zoomOn: { role: 'link', name: /Matías Rojas/, exact: false }, action: 'none', zoom: 1.35,
    },
    {
      title: 'La semana pasada', text: 'De lunes a domingo, hora de Chile: lo mismo que te llega el lunes.',
      say: 'Cambia a la semana pasada cuando quieras.',
      target: { role: 'button', name: 'Semana pasada' }, zoom: 1.6, arrow: true,
      waitFor: { text: /^La semana pasada escribiste/, exact: false },
    },
    {
      title: 'Tu equipo', text: 'Si administras: los totales y una fila por cada persona que tuvo actividad.',
      say: 'En «Equipo», cómo le fue a cada persona.', postit: 'Quien no envió nada aparece en gris, y «Para esta semana» te lo recuerda.',
      target: { role: 'button', name: 'Equipo', within: { role: 'group', name: 'Informe' } }, zoom: 1.6,
      waitFor: { role: 'table' },
    },
    {
      title: 'Por persona', text: 'Enviados, respuestas, reuniones y lo que tiene por responder. Quien no hizo nada queda en una línea.',
      say: 'Enviados, respuestas y pendientes de cada uno.',
      target: { role: 'table' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Metas del equipo', text: 'Si administras: la meta del equipo y, para quien necesite otra, la suya.',
      say: 'Desde aquí pones las metas del equipo.',
      target: { role: 'button', name: 'Metas del equipo' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'heading', name: 'Metas del equipo' },
    },
    {
      title: 'Una meta simple', text: 'Personas a contactar y contactos nuevos con correo, cada semana, por persona.',
      say: 'Por ejemplo, doce personas contactadas a la semana.', postit: 'Con 0 en ambas, el equipo no usa metas.',
      target: { css: '#goal-team-contacted' }, type: '12', zoom: 1.4, arrow: true,
    },
    {
      title: 'Guarda', text: 'Cada persona la ve en «Hoy» y en sus avisos.',
      say: 'Guarda, y cada persona la ve en Hoy.',
      target: { role: 'button', name: 'Guardar metas' }, zoom: 1.5,
      waitFor: { text: 'Guardamos las metas del equipo.' },
    },
    {
      title: 'Oportunidades', text: 'Lo que llegó en la semana y lo que cierra en los próximos 7 días.',
      say: 'En «Oportunidades», lo que cierra pronto.',
      target: { role: 'button', name: 'Oportunidades', within: { role: 'group', name: 'Informe' } }, zoom: 1.6,
      waitFor: { role: 'heading', name: 'Cierran en los próximos 7 días' },
    },
    {
      title: 'Sin asignar', text: 'Lo que cierra y nadie tiene asignado, marcado para que no se pase.',
      say: 'Y lo que nadie tiene asignado.', postit: 'Un administrador elige quién lo recibe en «Gestores de oportunidades».',
      target: { text: 'Sin asignar' }, zoomOn: { role: 'heading', name: 'Cierran en los próximos 7 días' }, action: 'none', zoom: 1.25, arrow: true,
    },
    {
      title: 'Cada lunes en tu correo', text: 'A las 8:00, desde tu Gmail u Outlook conectado, hacia ti. Sin seguimiento ni enlace de baja.',
      say: 'Enciéndelo y te llega cada lunes.',
      target: { role: 'switch', name: 'Recibirlo por correo cada lunes' }, zoom: 1.5, arrow: true,
      waitFor: { css: '#weekly-email[data-state="checked"]' },
    },
    {
      title: 'Avisos por correo', text: 'De martes a viernes en la mañana, solo cuando hay algo que hacer: una respuesta, un compromiso, lo que cierra o tu meta.',
      say: 'Y en la semana, un aviso solo cuando hay algo que hacer.', postit: 'Martes y viernes trae tus contactos de la semana.',
      target: { role: 'switch', name: 'Avisos por correo' }, action: 'none', zoom: 1.5, arrow: true,
    },
  ],
  outro: {
    title: 'Tu semana, sin armarla a mano', text: 'Míralo el lunes y empieza por lo que te espera.',
    items: ['Una frase, cuatro cifras y tu meta', 'Tu equipo, sus metas y Oportunidades', 'El informe cada lunes y avisos en la semana'],
  },
};
