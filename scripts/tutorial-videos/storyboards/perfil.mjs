const PROFILE = {
  companyName: 'Yago QA', sector: 'Selección de personal', website: 'https://yago-qa.cl', domain: 'yago-qa.cl',
  description: 'Consultora de selección para empresas con alta rotación.',
  services: ['Selección masiva para retail y logística', 'Evaluación psicolaboral', 'Onboarding de nuevos ingresos'],
  valueProposition: 'Cubrimos vacantes masivas en 10 días hábiles, con garantía de reposición.',
  painPoints: ['Vacantes que tardan semanas en cubrirse', 'Alta rotación en los primeros 90 días'],
  differentiators: ['Equipo dedicado por cliente', 'Informe semanal de avance'],
  proofPoints: ['Más de 3.000 contrataciones al año'], referenceClients: [],
  targetIndustries: ['Retail', 'Logística'], targetRoles: ['Gerente de Personas', 'Jefe de Reclutamiento'],
  targetCompanySize: '201-500', targetLocations: ['Chile'],
  sources: {}, pagesRead: [{ url: 'https://yago-qa.cl', title: 'Inicio' }, { url: 'https://yago-qa.cl/servicios', title: 'Servicios' }], emptyReason: null, websiteFrom: 'input',
};

export default {
  id: 'perfil', title: 'Perfil', persona: 'member', start: '/profile',
  intro: 'Lo que la IA sabe de tu empresa y de tu cliente ideal: con esto busca, investiga y escribe.',
  learn: ['Llenar el perfil desde tu sitio', 'Revisar lo que propone la IA', 'Guardar tu oferta'],
  mocks: [{ url: '**/api/ai/company-profile', method: 'POST', respond: PROFILE }],
  scenes: [
    {
      title: 'Escribe tu sitio', text: 'La IA lo lee y propone tu perfil, con la fuente de cada dato.',
      say: 'En «Perfil», escribe el sitio de tu empresa.',
      target: { label: 'Sitio web de tu empresa' }, type: 'yago-qa.cl', zoom: 1.7, arrow: true,
    },
    {
      title: 'Léelo con IA', text: 'Lee las páginas principales de tu sitio.',
      say: 'Pulsa «Leer mi sitio».',
      target: { role: 'button', name: 'Leer mi sitio' }, zoom: 1.7,
      waitFor: { role: 'heading', name: 'Revisa lo que encontramos' },
    },
    {
      title: 'Revisa y elige', text: 'Ves cada campo propuesto y de dónde salió. Nada se guarda sin tu visto bueno.',
      say: 'Revisa lo que encontró y elige qué usar.', postit: 'Lo que la IA deduce aparece como «Sugerencia».',
      target: { role: 'button', name: /^Usar \d+ campos?$/, exact: false }, zoom: 1.3, arrow: true,
      waitFor: { text: /para revisar/, exact: false },
    },
    {
      title: 'Tu oferta', text: 'Servicios, propuesta de valor y pruebas: la IA solo afirma lo que está aquí.',
      say: 'Ajusta tu oferta: la IA solo dice lo que está escrito aquí.', postit: 'Mientras más concreto, mejores correos.',
      target: { label: 'Propuesta de valor' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Guarda', text: 'Desde ahora la IA usa estos datos para buscar, investigar y escribir.',
      say: 'Guarda los cambios.',
      target: { role: 'button', name: 'Guardar cambios' }, zoom: 1.4,
      waitFor: { text: 'Perfil guardado' },
    },
  ],
  outro: { title: 'Tu perfil está listo', text: 'La IA ya sabe qué vendes y a quién.', items: ['Se llena desde tu sitio', 'Tú eliges qué guardar', 'La IA solo afirma lo que escribiste'] },
};
