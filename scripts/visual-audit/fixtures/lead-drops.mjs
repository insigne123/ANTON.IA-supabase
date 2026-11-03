// «Contacto del día» (src/lib/lead-drops.ts): today's contact of the owner, found with Apollo's free search (3 Nov 2026), so its
// email is looked up on «Enriquecer y guardar». A made-up person and company, with why we recommend them, a first email and
// three follow-ups as the Writer writes them for the demo account (Yago QA, background checks).
export const AUDIT_DROP_ID = '00000000-0000-4000-8000-000000000951';

export default ctx => {
  const signature = 'Camila Torres\nYago QA';
  const item = {
    leadId: '6accdbfcd5f5d80001cf6901', provider: 'apollo', name: 'Carolina Ve***a', title: 'Jefa de Recursos Humanos', company: 'Ferretería Austral',
    domain: null, industry: 'Retail', size: null, city: null, state: null, country: null, hasEmail: true, hasPhone: false,
    seniority: 'Jefatura de área', department: 'Recursos humanos', website: null, companyLinkedin: null, summary: null,
    why: 'Calza con tu cliente ideal por su cargo y su rubro (retail).',
    reasons: ['Ella decide cómo se revisa a quien entra: cada ingreso de temporada pasa por su equipo.',
      'Una cadena de ferreterías suma personal cada verano y cada antecedente pendiente es un puesto vacío.'],
    approach: 'Pregúntale cuántos ingresos revisan en temporada alta y quién los revisa hoy.',
    fit: [
      { criterion: 'Cargo', theirs: 'Jefa de Recursos Humanos', wanted: 'Gerente de Personas, Jefe de Reclutamiento', match: 'partial' },
      { criterion: 'Rubro', theirs: 'Dentro de lo que buscas', wanted: 'Retail', match: 'yes' },
      { criterion: 'Lugar', theirs: 'Dentro de lo que buscas', wanted: 'Chile', match: 'yes' },
    ],
    research: [],
    draft: { subject: 'Ingresos de temporada en Ferretería Austral', body: `Hola Carolina,\n\nAntes del verano, una cadena de ferreterías suma vendedores en pocas semanas, y cada revisión de antecedentes que se demora es un puesto vacío en plena temporada.\n\nEn Yago QA revisamos los antecedentes de cada postulante en minutos, con el respaldo de cada consulta.\n\n¿Cuántas personas piensan sumar esta temporada?\n\n${signature}` },
    followUps: [
      { day: 3, subject: 'Re: ingresos de temporada', body: `Hola Carolina,\n\nCuando la fecha de ingreso llega antes que los antecedentes, alguien termina llamando a cada postulante.\n\n¿Quién hace hoy esa revisión en tu equipo?\n\n${signature}` },
      { day: 7, subject: 'Un ingreso, en minutos', body: `Hola Carolina,\n\nUn día cualquiera de diciembre: entran doce vendedores el lunes y el viernes todavía faltan cuatro revisiones.\n\nCon Yago QA esas cuatro quedan listas el mismo lunes. ¿Te sirve verlo con un caso tuyo?\n\n${signature}` },
      { day: 11, subject: 'Cierro aquí', body: `Hola Carolina,\n\nEs mi último correo: si la revisión de ingresos no es prioridad ahora, lo entiendo.\n\n¿Te escribo de nuevo antes de la próxima temporada?\n\n${signature}` },
    ],
  };
  return { tables: { lead_drops: [{
    id: AUDIT_DROP_ID, organization_id: ctx.ORG, user_id: ctx.OWNER, drop_date: new Date(ctx.now).toISOString().slice(0, 10), status: 'ready',
    criteria: { titles: ['Gerente de Personas', 'Jefe de Reclutamiento'], industries: ['Retail'], locations: ['Chile'], sizes: [], source: 'perfil' },
    items: [item], cost_usd: 0, error: null, opened_at: null, saved_at: null, created_at: ctx.daysAgo(0), updated_at: ctx.daysAgo(0),
  }] } };
};
