// «Administración»: the panel where an owner or admin sees who uses the app and for what, what needs attention, the team
// and its credits. The usage report is answered by the browser with a made-up team of eight (the bench has two people), in
// the shape /api/dashboard/admin/usage returns; nobody here is real.
const NAV = { role: 'navigation', name: 'Navegación principal' };
const ADMIN_NAV = { role: 'navigation', name: 'Administración' };
const ORG = '00000000-0000-4000-8000-000000000001';
const person = (n, name, email, values) => ({ id: `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`, organizationId: ORG, name, email,
  member: true, groupIds: [n % 2 ? 'demo-team-1' : 'demo-team-2'], ...values });
const commercial = (values = {}) => ({ saved: 0, researchCompleted: 0, drafts: 0, contacted: 0, humanReplies: 0, interested: 0, meetingRequested: 0,
  meetingRegistered: 0, meetingCompleted: 0, linkedinConfirmed: 0, qualified: 0, negotiating: 0, won: 0, lost: 0, ...values });
// Each one: days with use in the period, credits, modules and results; the last two have not used the app.
const TEAM = [
  person(1, 'Valentina Ríos', 'valentina.rios@demo.cl', { days: 0.8, credits: 46, modules: ['search', 'contacts', 'research', 'email', 'campaigns'], pending: 2,
    commercial: commercial({ saved: 64, researchCompleted: 12, drafts: 18, contacted: 24, humanReplies: 5, interested: 3, meetingRegistered: 1 }) }),
  person(2, 'Matías Soto', 'matias.soto@demo.cl', { days: 0.7, credits: 31, modules: ['search', 'contacts', 'email'], pending: 7,
    commercial: commercial({ saved: 41, researchCompleted: 4, drafts: 11, contacted: 16, humanReplies: 2, interested: 1, meetingRegistered: 1 }) }),
  person(3, 'Josefa Muñoz', 'josefa.munoz@demo.cl', { days: 0.5, credits: 18, modules: ['search', 'contacts'], pending: 0,
    commercial: commercial({ saved: 27, contacted: 9, humanReplies: 1, interested: 1 }) }),
  person(4, 'Diego Fuentes', 'diego.fuentes@demo.cl', { days: 0.4, credits: 12, modules: ['search', 'contacts', 'crm'], pending: 0,
    commercial: commercial({ saved: 15, contacted: 9, humanReplies: 1 }) }),
  person(5, 'Camila Torres', 'camila.torres@demo.cl', { days: 0.3, credits: 9, modules: ['admin', 'search'], pending: 0, commercial: commercial({ saved: 6 }) }),
  person(6, 'Benjamín Rojas', 'benjamin.rojas@demo.cl', { days: 0.1, credits: 0, modules: ['search'], pending: 2, commercial: commercial() }),
  person(7, 'Antonia Vera', 'antonia.vera@demo.cl', { days: 0, credits: null, modules: [], pending: 0, commercial: commercial() }),
  person(8, 'Felipe Contreras', 'felipe.contreras@demo.cl', { days: 0, credits: null, modules: [], pending: 0, commercial: commercial() }),
];
const LABELS = { home: 'Inicio', search: 'Buscar contactos', contacts: 'Contactos', research: 'Investigación', email: 'Correos', campaigns: 'Campañas',
  linkedin: 'LinkedIn', crm: 'CRM y seguimiento', cowork: 'Cowork', opportunities: 'Oportunidades', settings: 'Perfil y conexiones', help: 'Ayuda', admin: 'Administración' };
const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) || 0), 0);
const addCommercial = rows => Object.fromEntries(Object.keys(commercial()).map(key => [key, sum(rows, row => row.commercial[key])]));
const shift = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The report for the period the screen asks for, for the whole team or for one person. */
function usageReport(request) {
  const params = new URL(request.url()).searchParams;
  const from = params.get('from'), to = params.get('to'), only = params.get('userId');
  const days = [];
  for (let day = from; day <= to; day = shift(day, 1)) days.push(day);
  const weekdays = days.filter(day => ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()));
  const scale = Math.min(1, days.length / 30);
  const team = TEAM.filter(p => !only || p.id === only);
  const people = team.map(p => {
    const activeDays = Math.round(weekdays.length * p.days);
    const lastAt = activeDays ? `${weekdays.at(-1 - (p.days < 0.5 ? 2 : 0)) || to}T${p.days > 0.6 ? '17:42' : '11:05'}:00-03:00` : null;
    const scaled = Object.fromEntries(Object.entries(p.commercial).map(([key, value]) => [key, Math.round(value * scale)]));
    return { id: p.id, organizationId: ORG, name: p.name, email: p.email, member: true, groupIds: p.groupIds, activeDays, lastAt, modules: activeDays ? p.modules : [],
      credits: p.credits === null ? null : Math.round(p.credits * scale), commercial: scaled, pending: p.pending };
  });
  const active = people.filter(p => p.activeDays > 0);
  const daily = days.map((day, index) => {
    const weekday = weekdays.includes(day);
    const here = weekday ? active.filter((p, n) => (index + n) % Math.max(1, Math.round(1 / TEAM.find(t => t.id === p.id).days)) === 0) : [];
    const credits = sum(here, p => Math.max(1, Math.round((p.credits || 0) / Math.max(1, p.activeDays))));
    return { day, active: here.length, credits, commercial: commercial({ contacted: sum(here, p => Math.round(p.commercial.contacted / Math.max(1, p.activeDays))) }),
      modules: [...new Set(here.flatMap(p => p.modules))], firstAt: here.length ? `${day}T09:${10 + index % 40}:00-03:00` : null,
      lastAt: here.length ? `${day}T18:${10 + index % 40}:00-03:00` : null, actions: here.length * 4,
      people: here.map(p => ({ id: p.id, organizationId: ORG, name: p.name, active: true, modules: p.modules, commercial: commercial({ contacted: 1 }) })) };
  });
  const moduleIds = ['home', 'search', 'contacts', 'research', 'email', 'campaigns', 'crm', 'admin'];
  const modules = moduleIds.map(id => {
    const users = active.filter(p => p.modules.includes(id) || id === 'home').length;
    return { id, label: LABELS[id], users, visits: users * (id === 'home' ? 7 : 5) + (id === 'search' ? 21 : 0), operations: id === 'home' || id === 'admin' ? 0 : users * 6 };
  }).filter(m => m.users).sort((a, b) => b.users - a.users || b.operations - a.operations);
  const total = addCommercial(people);
  const valentina = TEAM[0], matias = TEAM[1], benjamin = TEAM[5];
  const diagnostics = [
    { id: 'interest', category: 'pending', title: 'Interés pendiente de atender', detail: 'Hay conversaciones con interés que todavía necesitan atención del responsable.', count: 2, organizationId: ORG, userId: valentina.id, href: '/contacted?view=replied' },
    { id: 'prepared', category: 'pending', title: 'Contactos preparados por trabajar', detail: 'Hay borradores disponibles para revisar. Comprueba qué canal y siguiente paso corresponde.', count: 7, organizationId: ORG, userId: matias.id, href: '/saved/leads/enriched' },
    { id: 'mail', category: 'setup', title: 'Conexión de correo pendiente', detail: 'No hay una conexión de correo registrada para estas personas.', count: 1, organizationId: ORG, userId: benjamin.id, href: '/connections' },
    { id: 'observing', category: 'observing', title: 'Resultados todavía por observar', detail: '14 contactos no completaron la ventana de 14 días; hay 0 respuestas y 0 resultados de interés con observación incompleta.', count: 14, organizationId: null, userId: null, href: '/dashboard/admin/usage?view=commercial' },
  ].filter(d => !only || d.userId === only);
  const contacted = total.contacted;
  return {
    range: { from, to }, generatedAt: new Date().toISOString(), activityZone: 'America/Santiago', creditZone: 'UTC',
    organizations: [{ id: ORG, name: 'Yago QA' }], groups: [{ id: 'demo-team-1', organizationId: ORG, name: 'Ventas Santiago' }, { id: 'demo-team-2', organizationId: ORG, name: 'Ventas regiones' }],
    coverage: { captureFrom: null, journalFrom: null, unavailable: [], legacyReplies: 0, unassignedCredits: 0, source: 'sql' },
    summary: { active: active.length, people: people.length, activeDays: weekdays.length, credits: sum(people, p => p.credits), commercial: total },
    modules, daily, people,
    conversion: { contacted, mature: Math.round(contacted * 0.76), observing: contacted - Math.round(contacted * 0.76), replies: total.humanReplies, interested: total.interested,
      unknown: 0, interestUnknown: 0, replyRate: contacted ? Math.round(total.humanReplies / Math.round(contacted * 0.76) * 1000) / 10 : null,
      interestRate: contacted ? Math.round(total.interested / Math.round(contacted * 0.76) * 1000) / 10 : null, horizon: Number(params.get('horizon')) || 14 },
    previousConversion: { contacted: 41, mature: 41, observing: 0, replies: 6, interested: 3, unknown: 0, interestUnknown: 0, replyRate: 14.6, interestRate: 7.3, horizon: 14 },
    creditResources: [{ resource: 'search', net: Math.round(sum(people, p => p.credits) * 0.3) }, { resource: 'enrich', net: Math.round(sum(people, p => p.credits) * 0.58) },
      { resource: 'investigate', net: sum(people, p => p.credits) - Math.round(sum(people, p => p.credits) * 0.3) - Math.round(sum(people, p => p.credits) * 0.58) }],
    diagnostics, today: to, platform: false, viewerUserId: TEAM[4].id, activeOrganizationId: ORG, selectedOrganizationId: ORG, ready: true,
    limits: people.map(p => ({ organizationId: ORG, userId: p.id, used: Math.min(40, Math.round((p.credits || 0) / 4)), limit: 40, remaining: 40 - Math.min(40, Math.round((p.credits || 0) / 4)), mode: 'daily', binding: 'individual' })),
  };
}

export default {
  id: 'administracion', title: 'Administración', start: '/dashboard',
  intro: 'Para dueños y administradores: quién usa ANTON.IA, para qué, qué necesita atención y cómo se reparten los créditos.',
  learn: ['Leer el uso de tu equipo en un período', 'Ver qué necesita atención', 'Revisar a cada persona', 'Invitar, armar equipos y fijar créditos'],
  mocks: [{ url: /\/api\/dashboard\/admin\/usage\?/, method: 'GET', respond: (body, request) => usageReport(request) }],
  scenes: [
    {
      title: 'Abre Administración', text: 'Está al final del menú. Solo la ven los dueños y administradores.',
      say: 'Abre Administración desde el menú.',
      target: { role: 'link', name: 'Administración', within: NAV },
      waitFor: { css: '[data-tour="admin-metrics"]' },
    },
    {
      title: 'Cuatro secciones', text: 'Uso y resultados, Personas, Equipos y Créditos. Empiezas en el uso.',
      say: 'El panel tiene cuatro secciones.',
      target: { css: '[data-tour="admin-nav"]' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Elige el período', text: 'Hoy, 7, 30 o 90 días, o tus propias fechas. Todo el informe cambia con lo que elijas.',
      say: 'Elige el período que quieres revisar.', postit: 'También puedes filtrar por equipo.',
      target: { role: 'group', name: 'Períodos rápidos' }, action: 'none', zoom: 1.6, arrow: true,
    },
    {
      title: 'Lo esencial en cuatro cifras', text: 'Cuántas personas la usaron, el interés y las reuniones que lograron, y los créditos gastados.',
      say: 'Arriba, lo esencial en cuatro cifras.',
      target: { css: '[data-tour="admin-metrics"]' }, action: 'none', zoom: 1.25,
    },
    {
      title: 'Cuándo y para qué la usan', text: 'Los días con más uso y cuántas personas usan cada pantalla: buscar, contactos, correos.',
      say: 'Cuándo la usan y para qué.',
      target: { text: 'Para qué la utilizan' }, action: 'none', zoom: 1.2, arrow: true,
    },
    {
      title: 'Qué necesita atención', text: 'Señales concretas, cada una con su evidencia y la persona responsable.',
      say: 'Lo que necesita atención, con su evidencia.', postit: '«Ver persona» abre el detalle de quien la necesita.',
      target: { css: '[data-tour="admin-attention"]' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Persona por persona', text: 'Quién la usó, cuántos días, qué pantallas y cuántos créditos.',
      say: 'En la pestaña Personas, cada persona y su uso.',
      target: { role: 'tab', name: 'Personas' }, zoom: 1.35,
      waitFor: { role: 'button', name: 'Ver uso de Valentina Ríos' },
    },
    {
      title: 'Quién la usa y quién no', text: 'Ordena por actividad, días o créditos. Quien no la usa aparece sin uso registrado.',
      say: 'Así ves quién la usa y quién no.',
      target: { role: 'table' }, action: 'none', zoom: 1.2, highlight: false,
    },
    {
      title: 'Abre a una persona', text: 'Su actividad, sus resultados y el cupo de créditos que le queda hoy.',
      say: 'Toca a una persona para ver su detalle.',
      target: { role: 'button', name: 'Valentina Ríos', exact: true }, zoom: 1.5, arrow: true,
      waitFor: { role: 'heading', name: 'Valentina Ríos' }, hold: 0.8,
    },
    {
      title: 'Su detalle', text: 'Sus días con uso, el interés y las reuniones que logró, y sus créditos. «Volver al equipo» regresa a la lista.',
      say: 'Ahí ves su detalle.',
      target: { css: '[data-tour="admin-metrics"]' }, action: 'none', zoom: 1.15,
    },
    {
      title: 'Llévatelo en una planilla', text: '«Exportar resumen» descarga el informe del período para compartirlo.',
      say: 'Y puedes exportar el resumen.',
      target: { role: 'button', name: 'Exportar resumen' }, action: 'hover', zoom: 1.15, arrow: true,
    },
    {
      title: 'Personas', text: 'Quiénes tienen acceso, su rol, su equipo y cómo les va.',
      say: 'En Personas ves a todo tu equipo.',
      target: { role: 'link', name: 'Personas', within: ADMIN_NAV }, zoom: 1.6,
      waitFor: { role: 'heading', name: 'Personas' },
    },
    {
      title: 'Invita a tu equipo', text: '«Invitar miembro» envía el acceso por correo.',
      say: 'Y desde aquí invitas a alguien nuevo.',
      target: { role: 'button', name: 'Invitar miembro' }, action: 'hover', zoom: 1.15, arrow: true,
    },
    {
      title: 'Arma equipos', text: 'Agrupa personas para comparar resultados y compartir límites de créditos.',
      say: 'En Equipos, agrupas a las personas.',
      target: { role: 'link', name: 'Equipos', within: ADMIN_NAV }, zoom: 1.6,
      waitFor: { role: 'button', name: 'Crear equipo' }, hold: 1.2,
    },
    {
      title: 'Créditos', text: 'Cuánto puede usar cada persona al día.',
      say: 'Y en Créditos, decides cuánto puede usar cada uno.',
      target: { role: 'link', name: 'Créditos', within: ADMIN_NAV }, zoom: 1.6,
      waitFor: { css: '[data-tour="admin-credits-organization"]' },
    },
    {
      title: 'Un límite para todos', text: 'La regla de la organización vale para todos, salvo que un equipo o una persona tenga una propia.',
      say: 'Un límite diario para todos, con excepciones si las necesitas.', postit: 'Los cambios se aplican desde el próximo reinicio diario.',
      target: { css: '[data-tour="admin-credits-organization"]' }, action: 'none', zoom: 1.2,
    },
  ],
  outro: {
    title: 'Tu equipo, de un vistazo', text: 'Revísalo cada semana para acompañar a quien lo necesita.',
    items: ['Período y cuatro cifras', 'Qué necesita atención', 'Persona por persona', 'Personas, Equipos y Créditos'],
  },
};
