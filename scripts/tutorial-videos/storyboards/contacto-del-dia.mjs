import { chileDay, homeScope } from './home-scope.mjs';

// «Contacto del día» (src/lib/lead-drops.ts) is answered here: the contact is found by the scheduler with Leads Finder
// and the AI, which the bench does not run. Same shapes as /api/lead-drops/latest and /api/lead-drops/<id>; a made-up
// person and company, written as the Writer writes them for the demo account (Camila Torres, Yago QA, background checks).
const DROP_ID = '00000000-0000-4000-8000-000000000901';
const CRITERIA = { titles: ['Gerente de Personas', 'Jefe de Reclutamiento'], industries: ['Retail', 'Logística', 'Supermercados'], locations: ['Chile'], sizes: ['201-500'], source: 'perfil' };
const SIGNATURE = 'Camila Torres\nYago QA';
const person = (n, name, title, company, industry, size, city, about, hasPhone, subject, body) => ({
  leadId: `lf_demo_${n}`, name, title, company, domain: null, industry, size, city, hasEmail: true, hasPhone,
  why: `Calza con tu cliente ideal por su cargo y su rubro (${industry.toLowerCase()}), en ${city}.`,
  research: [about, `${industry} · ${size.toLocaleString('es-CL')} personas · ${city}`],
  draft: { subject, body: `${body}\n\n${SIGNATURE}` },
});
const CONTACT = person(1, 'Fernanda Rojas', 'Gerente de Personas', 'Retail Austral', 'Retail', 500, 'Santiago',
  'Retail Austral tiene 38 tiendas de vestuario en el sur de Chile y suma vendedores cada temporada.', true,
  'Contrataciones de temporada en Retail Austral',
  'Hola Fernanda,\n\nAntes de diciembre, una cadena con 38 tiendas suma decenas de vendedores en pocas semanas, y cada revisión de antecedentes que se demora es un puesto vacío en plena temporada.\n\nEn Yago QA revisamos los antecedentes de cada postulante en minutos, con el respaldo de cada consulta.\n\n¿Cuántas personas piensan sumar esta temporada?');
let saved = false;
const items = () => [saved ? { ...CONTACT, savedLeadId: 'demo-drop-lead-1' } : CONTACT];

export default {
  id: 'contacto-del-dia', title: 'Contacto del día', start: '/dashboard',
  intro: 'Martes, miércoles y viernes, un contacto nuevo con su correo: por qué te sirve, una investigación breve y un primer correo.',
  learn: ['Ver cómo se buscó', 'Leer la investigación y el primer correo', 'Guardarlo sin gastar créditos y escribirle'],
  mocks: [
    {
      url: '**/api/lead-drops/latest', method: 'GET',
      respond: (_body, request) => ({ scope: homeScope(request), drop: saved ? null
        : { id: DROP_ID, dropDate: chileDay(), total: 1, left: 1, next: { name: CONTACT.name, company: CONTACT.company, why: CONTACT.why } }, pull: null }),
    },
    { url: `**/api/lead-drops/${DROP_ID}`, method: 'GET', respond: () => ({ id: DROP_ID, date: chileDay(), criteria: CRITERIA, items: items() }) },
    {
      url: `**/api/lead-drops/${DROP_ID}`, method: 'POST',
      respond: () => { const fresh = !saved; saved = true; return { saved: fresh ? 1 : 0, expired: 0, items: items() }; },
    },
  ],
  scenes: [
    {
      title: 'Te espera en «Hoy»', text: 'Martes, miércoles y viernes, un contacto nuevo elegido para ti. También te llega en el aviso de la mañana, con un PDF.',
      say: 'Martes, miércoles y viernes, un contacto nuevo te espera en Hoy.', postit: 'Si no recibes correos, ábrelo en «Hoy»: se prepara en uno o dos minutos.',
      before: async () => { saved = false; },
      target: { role: 'link', name: 'Ver y guardar' }, zoomOn: { text: 'Contacto del día' }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Así lo buscamos' },
    },
    {
      title: 'Así lo buscamos', text: 'Bajo el contacto hay una fila: ábrela para ver cómo lo buscamos.',
      say: 'Así lo buscamos. Ábrelo para ver los filtros.',
      target: { role: 'button', name: 'Así lo buscamos', exact: false }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Revisamos que tengan correo verificado', exact: false },
    },
    {
      title: 'Tu cliente ideal, como filtros', text: 'Cargo, rubro y lugar de tu cliente ideal en «Perfil». Solo correos verificados y nadie que tu equipo ya tenga.',
      say: 'Son los filtros de tu cliente ideal.', postit: 'Sin cliente ideal en «Perfil», usamos el de tu equipo.',
      target: { text: 'Revisamos que tengan correo verificado', exact: false }, zoomOn: { css: 'section[aria-labelledby="drop-filters"]' }, action: 'none', zoom: 1.25,
    },
    {
      title: 'Por qué te sirve', text: 'Quién es, dónde trabaja y por qué calza contigo; si trae teléfono, también lo dice.',
      say: 'Quién es y por qué te sirve.',
      target: { text: CONTACT.why }, zoomOn: { css: 'section[aria-labelledby="drop-results"]' }, action: 'none', zoom: 1.3, arrow: true,
    },
    {
      title: 'Investigación y primer correo', text: 'Qué hace su empresa y un primer correo escrito para esa persona, con tu oferta y tu firma de «Perfil».',
      say: 'Con una investigación breve y su primer correo.', postit: '«Copiar» lo lleva a donde quieras. El mismo texto viene en el PDF del correo.',
      target: { text: CONTACT.draft.subject }, zoomOn: { text: 'Primer correo sugerido' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Guárdalo sin créditos', text: 'Ya trae su correo verificado: pasa a «Por escribir» sin gastar créditos.',
      say: 'Guárdalo en Por escribir, sin gastar créditos.',
      target: { role: 'button', name: 'Guardar en «Por escribir»' }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Quedó en «Por escribir», con su correo.', exact: false },
    },
    {
      title: 'Investígalo y escríbele', text: '«Investigar y escribirle» lo investiga a fondo en «Por escribir», en unos minutos. Luego «Preparar correos» deja el correo listo para revisarlo y enviarlo.',
      say: 'Y con un clic lo investigamos a fondo, para escribirle desde la app.', postit: 'El correo sugerido sigue aquí, con «Copiar».',
      target: { role: 'link', name: 'Investigar y escribirle' }, action: 'hover', zoom: 1.4, arrow: true,
    },
  ],
  outro: { title: 'Un contacto, tres días a la semana', text: 'Ábrelo desde el correo o desde «Hoy».', items: ['Por qué te sirve', 'Investigación y primer correo', 'Guardarlo no gasta créditos'] },
};
