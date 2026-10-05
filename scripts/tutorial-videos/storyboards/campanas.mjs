const AUDIENCE = ['Carolina Ibáñez', 'Pablo Quiroga', 'Daniela Paz', 'Tomás Lira'].map((name, index) => ({
  email: `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(' ', '.')}@empresa${index}.cl`,
  name, title: ['Gerente de Personas', 'Jefe de Reclutamiento', 'Subgerente de RR. HH.', 'Jefa de Selección'][index],
  company: ['Norte Sur Transportes', 'Andes Food', 'Retail Pacífico', 'Seguridad Central'][index], industry: 'retail', country: 'Chile',
  size: '201-500', seniority: 'manager', leadRef: `demo-lead-${index}`, lastSentAt: null, contacted: false, replied: false,
  blockedReason: null, reasons: ['Cargo y rubro calzan con tu búsqueda'], enriched: true,
}));
let last = null;
function campaignFrom(definition) {
  const people = AUDIENCE.filter(person => (definition?.emails || []).includes(person.email));
  last = {
    id: 'demo-camp-1', revision: 1, review_hash: 'demo-review-1', status: 'draft', approved_at: null, definition,
    recipients: people.map(person => ({ email: person.email, name: person.name, messages: (definition?.messages || []).map((message, index) => ({
      draftId: `demo-draft-${index}-${person.email}`, subject: message.subject.replace('{{nombre}}', person.name.split(' ')[0]),
      body: message.body.replace('{{nombre}}', person.name.split(' ')[0]), delayDays: message.delayDays,
    })) })),
  };
  return last;
}

export default {
  id: 'campanas', title: 'Campañas', start: '/campaigns',
  intro: 'Escríbele a un grupo de una vez: eliges la audiencia, escribes la secuencia y la apruebas.',
  learn: ['Elegir la audiencia', 'Escribir el correo y su seguimiento', 'Revisar y aprobar'],
  mocks: [
    { url: '**/api/campaigns/bulk/audience', method: 'POST', respond: { people: AUDIENCE, total: AUDIENCE.length, page: 0 } },
    { url: '**/api/campaigns/bulk', method: 'POST', respond: body => ({ campaign: campaignFrom(body) }) },
    { url: '**/api/campaigns/bulk/demo-camp-1', method: 'POST', respond: body => ({ campaign: { ...last, status: body?.action === 'approve' ? 'approved' : last?.status, approved_at: body?.action === 'approve' ? new Date().toISOString() : null, revision: 2 } }) },
  ],
  scenes: [
    {
      title: 'Nueva campaña', text: 'Hasta 100 personas con una sola aprobación.',
      say: 'Pulsa «Nueva campaña».',
      target: { role: 'button', name: 'Nueva campaña' }, zoom: 1.6, arrow: true,
      waitFor: { label: 'Nombre de campaña' },
    },
    {
      title: 'Ponle nombre', text: 'Para encontrarla después.',
      say: 'Ponle un nombre.',
      target: { label: 'Nombre de campaña' }, type: 'Primer contacto · Retail', zoom: 1.6,
    },
    {
      title: 'Elige la audiencia', text: 'Describe a tu lead ideal con IA, o usa filtros.',
      say: 'Elige a quién escribirle; aquí, con filtros.', postit: 'Solo entran contactos con correo y sin baja.',
      target: { role: 'button', name: 'Filtros manuales' }, zoom: 1.5,
    },
    {
      title: 'Por cargo', text: 'Cargos, industrias, países o tamaño, separados por comas.',
      say: 'Escribe el cargo y busca.',
      target: { label: 'Cargos (separados por comas)' }, type: 'Gerente de Personas', zoom: 1.6,
    },
    {
      title: 'Busca', text: 'Entre tus contactos enriquecidos.',
      say: 'Busca con esos filtros.',
      target: { role: 'button', name: 'Buscar con filtros' }, zoom: 1.5,
      waitFor: { text: /4 seleccionados/, exact: false },
    },
    {
      title: 'Ya quedan elegidos', text: 'Los resultados quedan marcados. Quita a quien no quieras con su casilla o «Quitar todos».',
      say: 'Quedan marcados: quita a quien sobre.',
      target: { text: /4 seleccionados/, exact: false }, action: 'none', zoom: 1.5,
    },
    {
      title: 'A los correos', text: 'El primero y sus seguimientos.',
      say: 'Ahora, los correos.',
      target: { role: 'button', name: 'Continuar a correos' }, zoom: 1.4,
      waitFor: { label: '¿Cuántos seguimientos quieres?' },
    },
    {
      title: '¿Cuántos seguimientos?', text: 'Cada seguimiento se detiene si la persona responde.',
      say: 'Elige cuántos seguimientos.', postit: 'La IA puede escribir toda la secuencia por ti.',
      target: { label: '¿Cuántos seguimientos quieres?' }, choose: '1', zoom: 1.6,
    },
    {
      title: 'El primer correo', text: 'Usa {{nombre}}, {{empresa}} y {{cargo}} para personalizar.',
      say: 'Escribe el asunto del primer correo.',
      target: { label: 'Asunto' }, type: 'Una idea para tu equipo de personas', zoom: 1.6,
    },
    {
      title: 'El cuerpo', text: 'Tu firma se agrega sola al enviar.',
      say: 'Y el mensaje.',
      target: { label: 'Correo' }, type: 'Hola {{nombre}}, vi que están contratando. ¿Conversamos 15 minutos?', zoom: 1.5,
    },
    {
      title: 'El seguimiento', text: 'Sale solo si no hubo respuesta, a los días que elijas.',
      say: 'Pasa al seguimiento.',
      target: { role: 'button', name: 'Seguimiento 1', within: { role: 'group', name: 'Correos de la secuencia' } }, zoom: 1.5,
    },
    {
      title: 'Escríbelo', text: 'Corto y sin repetir el primero.',
      say: 'Escribe el seguimiento.',
      target: { label: 'Asunto' }, type: 'Retomo mi correo anterior', zoom: 1.6,
      after: async frame => { await frame.getByLabel('Correo', { exact: true }).fill('Hola {{nombre}}, ¿pudiste verlo? Quedo atento.'); },
    },
    {
      title: 'Revisa cómo le llega a cada uno', text: 'Ves los correos de cada persona antes de aprobar.',
      say: 'Guarda y revisa.',
      target: { role: 'button', name: 'Guardar y revisar correos' }, zoom: 1.4,
      waitFor: { role: 'button', name: 'Aprobar campaña' },
    },
    {
      title: 'Aprueba', text: 'Antes de aprobar no sale nada. Después puedes pausarla cuando quieras.',
      say: 'Aprueba la campaña.',
      target: { role: 'button', name: 'Aprobar campaña' }, zoom: 1.4, arrow: true,
      waitFor: { text: /Contenido y audiencia aprobados/, exact: false },
    },
  ],
  outro: { title: 'Campaña aprobada', text: 'Los correos salen en su fecha y se detienen si alguien responde.', items: ['Audiencia con filtros o con IA', 'Correo y seguimientos', 'Una sola aprobación'] },
};
