// The tasks of the simplicity measurement, done as a new person would: each step names the control by what the
// person reads on it, starting from «Hoy» or the menu. `ideal` is the fewest steps the task could take in a good design
// (expert judgment, written down so changes to it show in review). `dataset` and `persona` pick the situation: a new
// organization (`empty`) or one in use (`full`), the owner or a member. `mocks` answer, in the browser, the few calls a
// task needs that the bench blocks (search, enrichment, sending, AI); nothing leaves the machine.
import path from 'node:path';

const COMPANIES = [
  ['Norte Sur Transportes', 'nortesur.cl', 'logistics & supply chain', 420], ['Andes Food', 'andesfood.cl', 'food & beverages', 950],
  ['Retail Pacífico', 'retailpacifico.cl', 'retail', 1800], ['Seguridad Central', 'seguridadcentral.cl', 'security & investigations', 650],
];
const PEOPLE = ['Carolina Ibáñez', 'Pablo Quiroga', 'Marcela Toro', 'Rodrigo Fuentes', 'Daniela Paz', 'Tomás Lira', 'Fernanda Rey', 'Ignacio Vidal'];
const TITLES = ['Gerente de Personas', 'Jefe de Reclutamiento', 'Subgerente de RR. HH.', 'Jefa de Selección'];

const organization = ([name, domain, industry, size], index) => ({
  id: `usab-org-${index}`, name, primary_domain: domain, website_url: `https://www.${domain}`, industry, city: 'Santiago', country: 'Chile', estimated_num_employees: size,
});
const personFor = (company, index) => {
  const [first, last] = PEOPLE[index % PEOPLE.length].split(' ');
  const id = `usab-${company.id}-${index}`;
  return {
    id, name: `${first} ${last.slice(0, 2)}***${last.slice(-1)}`, first_name: first, last_name: `${last.slice(0, 2)}***${last.slice(-1)}`, has_email: true,
    title: TITLES[index % TITLES.length], city: 'Santiago', country: 'Chile', seniority: 'manager', departments: [],
    source_provider: 'apollo', source_provider_id: id, organization_id: company.id, organization_name: company.name, organization_domain: company.primary_domain,
    organization: { id: company.id, name: company.name, domain: company.primary_domain, industry: company.industry, website_url: company.website_url },
  };
};

const AUDIENCE = ['Carolina Ibáñez', 'Pablo Quiroga', 'Daniela Paz', 'Tomás Lira'].map((name, index) => ({
  email: `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(' ', '.')}@empresa${index}.cl`,
  name, title: TITLES[index % TITLES.length], company: COMPANIES[index % COMPANIES.length][0], industry: COMPANIES[index % COMPANIES.length][2],
  country: 'Chile', size: '201-500', seniority: 'manager', leadRef: `usab-lead-${index}`, lastSentAt: null, contacted: false, replied: false,
  blockedReason: null, reasons: ['Cargo y rubro calzan con tu búsqueda'], enriched: true,
}));
let lastCampaign = null;
function campaignFrom(definition, status) {
  const people = AUDIENCE.filter(person => (definition?.emails || []).includes(person.email));
  lastCampaign = {
    id: 'usab-camp-1', revision: 1, review_hash: 'usab-review-1', status, approved_at: null, definition,
    recipients: people.map(person => ({ email: person.email, name: person.name, messages: (definition?.messages || []).map((message, index) => ({
      draftId: `usab-draft-${index}-${person.email}`, subject: message.subject.replace('{{lead.firstName}}', person.name.split(' ')[0]),
      body: message.body.replace('{{lead.firstName}}', person.name.split(' ')[0]), delayDays: message.delayDays,
    })) })),
  };
  return lastCampaign;
}

export function TASKS(ctx, { fixtures }) {
  return [
    {
      id: 'perfil', module: 'Configuración', title: 'Completar el perfil', persona: 'member', start: '/dashboard', ideal: 4,
      steps: [
        { menu: 'Perfil' },
        { target: { label: 'Productos y servicios' }, fill: 'Selección de personal para retail y logística.' },
        { target: { label: 'Propuesta de valor' }, fill: 'Cubrimos vacantes masivas en 10 días.' },
        { target: { role: 'button', name: 'Guardar cambios' } },
      ],
      done: page => page.getByText('Perfil guardado').first().waitFor({ timeout: 10000 }),
    },
    {
      id: 'correo', module: 'Configuración', title: 'Conectar el correo', persona: 'member', start: '/dashboard', ideal: 2,
      steps: [
        { target: { role: 'link', name: /Conectar correo/ }, why: 'el paso «Conecta tu correo» de Hoy' },
        { target: { role: 'link', name: 'Conectar Gmail' } },
      ],
      mocks: [{ url: '**/api/auth/connect/google**', respond: { abort: true } }],
      done: (page, { calls }) => {
        if (!calls.some(call => call.url.includes('/api/auth/connect/google'))) throw new Error('no llegó a Google');
      },
    },
    {
      id: 'buscar', module: 'Prospectar', title: 'Encontrar 10 prospectos y guardarlos', persona: 'member', start: '/dashboard', ideal: 5,
      // A new person's first try, a job title alone, does not search: the screen asks for a company filter (see the report).
      // The path measured is the one the screen offers: a starting point, which fills titles and industries.
      steps: [
        { menu: 'Buscar prospectos' },
        { target: { role: 'button', name: /^Recursos Humanos/ } },
        { target: { role: 'button', name: 'Buscar empresas' } },
        { target: { role: 'button', name: 'Marcar todas' } },
        { target: { role: 'button', name: 'Buscar contactos' } },
        { target: { role: 'button', name: 'Marcar todos' } },
        { target: { role: 'button', name: /^Guardar \d+$/ } },
      ],
      mocks: [{
        url: '**/api/leads/search', method: 'POST',
        respond: body => {
          const companies = COMPANIES.map(organization);
          if (body?.search_mode === 'companies') return { organizations: companies, count: companies.length, page: 1, per_page: 25, total_entries: companies.length, total_pages: 1 };
          const company = companies.find(item => item.id === (body?.organization_id || body?.organizationId)) || companies[0];
          const leads = Array.from({ length: 4 }, (_, index) => personFor(company, index));
          return { leads, count: leads.length, leads_count: leads.length, organization_id: company.id, page: 1, per_page: 25, total_entries: leads.length, total_pages: 1 };
        },
      }, { url: '**/api/leads/search/checkpoint', method: 'PUT', respond: { ok: true } }],
      done: page => page.getByText(/Guardaste \d+ contactos?/).first().waitFor({ timeout: 15000 }),
    },
    {
      id: 'importar', module: 'Contactos', title: 'Subir un archivo de contactos', dataset: 'empty', start: '/dashboard', ideal: 4,
      steps: [
        { menu: 'Por completar' },
        { target: { role: 'link', name: 'Importar lista' } },
        { target: { role: 'button', name: 'Elegir archivo' }, upload: path.join(fixtures, 'prospectos.csv') },
        { target: { role: 'button', name: 'Revisar contactos' } },
        { target: { role: 'button', name: /^Importar \d+ contactos?$/ } },
      ],
      done: page => page.getByRole('heading', { name: /^Importaste \d+ contactos?$/ }).waitFor({ timeout: 15000 }),
    },
    {
      id: 'enriquecer', module: 'Contactos', title: 'Buscar el correo de un contacto', start: '/dashboard', ideal: 4,
      steps: [
        { menu: 'Por completar' },
        { target: { role: 'checkbox', name: 'Seleccionar a Florencia Sepúlveda' } },
        { target: { role: 'button', name: /^Buscar correo \(\d+\)$/ } },
        { target: { role: 'button', name: 'Completar datos', within: { role: 'dialog' } } },
      ],
      mocks: [{
        url: '**/api/opportunities/enrich-apollo', method: 'POST',
        respond: body => ({
          enriched: (body?.leads || []).map(lead => ({
            id: `usab-enriched-${lead.clientRef}`, clientRef: lead.clientRef, fullName: lead.fullName, email: 'florencia.sepulveda@seguridadaustral.cl',
            emailStatus: 'verified', title: 'Jefa de Reclutamiento Masivo', companyName: lead.companyName, enrichmentStatus: 'completed',
          })),
          usage: { consumed: (body?.leads || []).length },
        }),
      }],
      done: page => page.getByText('Búsqueda de correo lista').first().waitFor({ timeout: 15000 }),
    },
    {
      id: 'responder', module: 'Seguimiento', title: 'Responder a quien te escribió', start: '/dashboard', ideal: 4,
      steps: [
        { target: { role: 'link', name: 'Abrir conversación' } },
        { target: { role: 'button', name: 'Responder' }, timeout: 60000 },
        { target: { label: 'Tu respuesta' }, fill: 'Hola Andrea, ¿te acomoda el jueves a las 10?' },
        { target: { role: 'button', name: 'Enviar respuesta' } },
      ],
      mocks: [
        { url: '**/api/contacted/*/work', method: 'POST', respond: { ok: true } },
        // The same answer as the server's send route when it goes out: `success` and `status: 'sent'`.
        { url: '**/api/providers/send', method: 'POST', respond: { success: true, status: 'sent', messageId: 'usab-reply-1' } },
      ],
      done: async (page, { calls }) => {
        if (!calls.some(call => call.url.endsWith('/api/providers/send') && call.body?.deliveryMode === 'reply_contact')) throw new Error('no se envió la respuesta');
        // The person sees that it went out: a visible «Respuesta enviada…», wherever the screen puts it.
        await page.getByText(/Respuesta enviada/).first().waitFor({ timeout: 10000 });
      },
    },
    {
      id: 'pipeline', module: 'Seguimiento', title: 'Mover un negocio de etapa', start: '/dashboard', ideal: 4,
      steps: [
        { menu: 'Pipeline' },
        { target: { role: 'button', name: 'Tablero' } },
        { target: { role: 'button', name: /^Mover/ } },
        { target: { role: 'menuitemradio', name: 'Reunión' } },
      ],
      done: (page, { writes }) => {
        if (!writes.some(write => /unified|crm|sheet|custom/i.test(write.url))) throw new Error('la etapa no se guardó');
      },
    },
    {
      id: 'campana', module: 'Seguimiento', title: 'Crear y aprobar una campaña', start: '/dashboard', ideal: 8,
      steps: [
        { menu: 'Campañas' },
        { target: { role: 'button', name: 'Nueva campaña' } },
        { target: { label: 'Nombre de campaña' }, fill: 'Primer contacto · Retail' },
        { target: { role: 'button', name: 'Filtros manuales' } },
        { target: { label: 'Cargos (separados por comas)' }, fill: 'Gerente de Personas' },
        { target: { role: 'button', name: 'Buscar con filtros' } },
        { target: { role: 'button', name: 'Seleccionar todos' }, skipIf: async page => /\b[1-9]\d* seleccionados?\b/.test(await page.getByRole('status').filter({ hasText: 'seleccionado' }).first().innerText({ timeout: 2000 })) },
        { target: { role: 'button', name: 'Continuar a correos' } },
        { target: { label: '¿Cuántos seguimientos quieres?' }, choose: '1' },
        { target: { label: 'Asunto' }, fill: 'Una idea para tu equipo de personas' },
        { target: { label: 'Correo' }, fill: 'Hola {{lead.firstName}}, vi que están contratando. ¿Te sirve conversar 15 minutos?' },
        { target: { role: 'button', name: 'Seguimiento 1', within: { role: 'group', name: 'Correos de la secuencia' } } },
        { target: { label: 'Asunto' }, fill: 'Retomo mi correo anterior' },
        { target: { label: 'Correo' }, fill: 'Hola {{lead.firstName}}, ¿pudiste verlo? Quedo atento.' },
        { target: { role: 'button', name: 'Guardar y revisar correos' } },
        { target: { role: 'button', name: 'Aprobar campaña' } },
      ],
      mocks: [
        { url: '**/api/campaigns/bulk/audience', method: 'POST', respond: { people: AUDIENCE, total: AUDIENCE.length, page: 0 } },
        { url: '**/api/campaigns/bulk', method: 'POST', respond: body => ({ campaign: campaignFrom(body, 'draft') }) },
        { url: '**/api/campaigns/bulk/usab-camp-1', method: 'POST', respond: body => ({ campaign: { ...lastCampaign, status: body?.action === 'approve' ? 'approved' : lastCampaign.status, approved_at: body?.action === 'approve' ? new Date().toISOString() : null, revision: 2 } }) },
      ],
      done: page => page.getByText('Contenido y audiencia aprobados').first().waitFor({ timeout: 10000 }),
    },
    {
      // The same campaign by the main path of the email step (Plan 12, 7): the AI writes the initial email and its follow-up
      // from the goal, and the person reviews them before approving. «campana» keeps measuring writing both by hand.
      id: 'campana-ia', module: 'Seguimiento', title: 'Crear y aprobar una campaña con la IA', start: '/dashboard', ideal: 8,
      steps: [
        { menu: 'Campañas' },
        { target: { role: 'button', name: 'Nueva campaña' } },
        { target: { label: 'Nombre de campaña' }, fill: 'Primer contacto · Retail' },
        { target: { role: 'button', name: 'Filtros manuales' } },
        { target: { label: 'Cargos (separados por comas)' }, fill: 'Gerente de Personas' },
        { target: { role: 'button', name: 'Buscar con filtros' } },
        { target: { role: 'button', name: 'Seleccionar todos' }, skipIf: async page => /\b[1-9]\d* seleccionados?\b/.test(await page.getByRole('status').filter({ hasText: 'seleccionado' }).first().innerText({ timeout: 2000 })) },
        { target: { role: 'button', name: 'Continuar a correos' } },
        { target: { label: '¿Qué quieres conseguir con la campaña?' }, fill: 'Una reunión de 15 minutos para mostrar AXIS' },
        { target: { role: 'button', name: 'Generar secuencia con IA' } },
        { target: { role: 'button', name: 'Guardar y revisar correos' } },
        { target: { role: 'button', name: 'Aprobar campaña' } },
      ],
      mocks: [
        { url: '**/api/campaigns/bulk/audience', method: 'POST', respond: { people: AUDIENCE, total: AUDIENCE.length, page: 0 } },
        { url: '**/api/campaigns/bulk/assist', method: 'POST', respond: { messages: [
          { subject: 'Una idea para tu equipo de personas', body: 'Hola {{nombre}}, vi que en {{empresa}} están contratando. ¿Te sirve conversar 15 minutos esta semana?', delayDays: 0 },
          { subject: 'Retomo mi correo anterior', body: 'Hola {{nombre}}, ¿pudiste verlo? Si te sirve, te muestro AXIS en 15 minutos.', delayDays: 3 },
        ] } },
        { url: '**/api/campaigns/bulk', method: 'POST', respond: body => ({ campaign: campaignFrom(body, 'draft') }) },
        { url: '**/api/campaigns/bulk/usab-camp-1', method: 'POST', respond: body => ({ campaign: { ...lastCampaign, status: body?.action === 'approve' ? 'approved' : lastCampaign.status, approved_at: body?.action === 'approve' ? new Date().toISOString() : null, revision: 2 } }) },
      ],
      done: page => page.getByText('Contenido y audiencia aprobados').first().waitFor({ timeout: 10000 }),
    },
    {
      id: 'oportunidades', module: 'Prospectar', title: 'Ver las licitaciones', start: '/dashboard', ideal: 2,
      steps: [
        { menu: 'Oportunidades' },
        { target: { role: 'tab', name: /Licitaciones y Compra Ágil/ } },
      ],
      done: page => page.getByRole('tabpanel').first().waitFor({ timeout: 10000 }),
    },
    {
      id: 'cowork', module: 'Cowork', title: 'Pedirle algo a Cowork', start: '/dashboard', ideal: 3,
      steps: [
        { menu: 'Cowork' },
        { target: { label: 'Describe tu trabajo' }, fill: '¿A quién le escribo hoy?' },
        { target: { role: 'button', name: 'Crear trabajo' } },
      ],
      mocks: [{ url: '**/api/cowork/**', method: 'POST', respond: { ok: true } }],
      done: (page, { calls }) => {
        if (!calls.some(call => call.method === 'POST' && /cowork/.test(call.url))) throw new Error('no se envió el pedido');
      },
    },
    {
      id: 'cowork-informe', module: 'Cowork', title: 'Pedir un informe visual', start: '/dashboard', ideal: 3,
      // Measured up to sending, like «Pedirle algo a Cowork»: the bench has no model to write the artifact.
      steps: [
        { menu: 'Cowork' },
        { target: { label: 'Describe tu trabajo' }, fill: 'Hazme un tablero de mi pipeline por etapa' },
        { target: { role: 'button', name: 'Crear trabajo' } },
      ],
      mocks: [{ url: '**/api/cowork/**', method: 'POST', respond: { ok: true } }],
      done: (page, { calls }) => {
        if (!calls.some(call => call.method === 'POST' && /cowork/.test(call.url) && /tablero/.test(JSON.stringify(call.body)))) throw new Error('no se envió el pedido');
      },
    },
    {
      id: 'cowork-cambio', module: 'Cowork', title: 'Pedir un cambio a un artefacto', start: '/dashboard', ideal: 4,
      // The conversation of the audit fixtures that made «Pipeline por etapa», an artifact written in code.
      steps: [
        { menu: 'Cowork' },
        { target: { role: 'button', name: 'Mostrar trabajos' }, only: 'phone' },
        { target: { role: 'button', name: /Muéstrame mi pipeline/, exact: false } },
        { target: { role: 'button', name: /Pipeline por etapa/, exact: false } },
        { target: { label: 'Pedir cambios a este artefacto' }, fill: 'Agrega el total por etapa' },
        { target: { role: 'button', name: 'Pedir cambios' } },
      ],
      mocks: [{ url: '**/api/cowork/**', method: 'POST', respond: { ok: true } }],
      done: (page, { calls }) => {
        // The change goes in the same conversation, tied to the turn that made the artifact.
        const sent = calls.find(call => call.method === 'POST' && /cowork\/runs$/.test(call.url) && /total por etapa/.test(call.body?.message || ''));
        if (!sent) throw new Error('no se envió el cambio');
        if (!sent.body.parentRunId) throw new Error('el cambio abrió una conversación nueva');
        if (!/Pipeline por etapa/.test(sent.body.message)) throw new Error('el cambio no nombra el artefacto');
      },
    },
    {
      id: 'primer-correo', module: 'Correo', title: 'Escribir el primer correo', start: '/dashboard', ideal: 4,
      // The bench cannot run a research; the run is measured up to starting it, and the steps after the wait are counted
      // from the design (and said so in the report).
      steps: [
        { target: { role: 'link', name: /esperan tu primer mensaje|Escribir ahora/, exact: false } },
        { target: { role: 'button', name: 'Investigar' } },
        { target: { role: 'button', name: /^Investigar \d+$/, within: { role: 'dialog' } } },
      ],
      pending: { steps: 3, note: 'Tras 1 a 3 minutos de investigación: «Escribir», revisar el borrador y «Confirmar y enviar».' },
      mocks: [{ url: '**/api/native-research/run', method: 'POST', respond: { runId: 'usab-run-1', items: [] } },
        { url: '**/api/native-research/run/*', respond: { runId: 'usab-run-1', status: 'running', items: [] } }],
      done: page => page.getByText('Investigación iniciada').first().waitFor({ timeout: 10000 }),
    },
    {
      id: 'firma', module: 'Configuración', title: 'Poner tu teléfono en la firma y elegir un tono', start: '/dashboard', ideal: 5,
      // On the screen before PR 3b a signature could only be an uploaded image: there was no field to write it in.
      steps: [
        { menu: 'Firmas y estilo' },
        { target: { label: 'Teléfono' }, fill: '+56 9 1234 5678', why: 'la firma solo se podía subir como imagen' },
        { target: { role: 'button', name: 'Guardar firma' } },
        { target: { role: 'tab', name: 'Estilos' } },
        { target: { role: 'button', name: 'Cercano', within: { role: 'group', name: 'Tono' } } },
        { target: { role: 'button', name: 'Guardar estilo' } },
      ],
      mocks: [{ url: '**/api/email-styles', method: 'POST', respond: body => ({ style: { id: '00000000-0000-4000-8000-00000000c0de', name: body?.name, profile: body?.profile, isDefault: body?.isDefault, revision: 2, libraryScope: 'personal', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash: 'usab', archivedAt: null } }) }],
      done: (page, { calls }) => {
        if (!calls.some(call => call.url.endsWith('/api/email-styles') && call.body?.profile?.tone === 'warm')) throw new Error('el estilo no se guardó');
      },
    },
  ];
}
