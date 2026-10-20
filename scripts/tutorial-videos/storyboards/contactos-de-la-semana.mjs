import { chileDay, homeScope } from './home-scope.mjs';

// «Contactos de la semana» (src/lib/lead-drops.ts) is answered here: the drop is made by the scheduler with Leads Finder
// and the AI, which the bench does not run. Same shapes as /api/lead-drops/latest and /api/lead-drops/<id>; made-up
// people and companies, written as the Writer writes them for the demo account (Camila Torres, Yago QA, background checks).
const DROP_ID = '00000000-0000-4000-8000-000000000901';
const CRITERIA = { titles: ['Gerente de Personas', 'Jefe de Reclutamiento'], industries: ['Retail', 'Logística', 'Supermercados'], locations: ['Chile'], sizes: ['201-500'], source: 'perfil' };
const SIGNATURE = 'Camila Torres\nYago QA';
const person = (n, name, title, company, industry, size, city, about, hasPhone, subject, body) => ({
  leadId: `lf_demo_${n}`, name, title, company, domain: null, industry, size, city, hasEmail: true, hasPhone,
  why: `${title} en ${industry.toLowerCase()} en ${city}: calza con tu cliente ideal.`,
  research: [about, `${industry} · ${size.toLocaleString('es-CL')} personas · ${city}`],
  draft: { subject, body: `${body}\n\n${SIGNATURE}` },
});
const ITEMS = [
  person(1, 'Fernanda Rojas', 'Gerente de Personas', 'Retail Austral', 'Retail', 500, 'Santiago',
    'Retail Austral tiene 38 tiendas de vestuario en el sur de Chile y suma vendedores cada temporada.', true,
    'Contrataciones de temporada en Retail Austral',
    'Hola Fernanda,\n\nAntes de diciembre, una cadena con 38 tiendas suma decenas de vendedores en pocas semanas, y cada revisión de antecedentes que se demora es un puesto vacío en plena temporada.\n\nEn Yago QA revisamos los antecedentes de cada postulante en minutos, con el respaldo de cada consulta.\n\n¿Cuántas personas piensan sumar esta temporada?'),
  person(2, 'Ignacio Paredes', 'Jefe de Reclutamiento', 'Logística Andes', 'Logística', 300, 'Quilicura',
    'Logística Andes opera centros de distribución para supermercados y despacha carga a todo Chile.', true,
    'Conductores y operarios sin esperar la revisión',
    'Hola Ignacio,\n\nEn un centro de distribución, un operario que no puede empezar el lunes porque falta revisar sus antecedentes atrasa los despachos de toda la semana.\n\nEn Yago QA esa revisión toma minutos, con el respaldo de cada consulta.\n\n¿Cuántos ingresos tienen al mes en Quilicura?'),
  person(3, 'Josefina Lagos', 'Gerente de Personas', 'Supermercados del Valle', 'Supermercados', 400, 'Rancagua',
    'Supermercados del Valle tiene 12 locales en la Región de O\'Higgins y abre uno nuevo en marzo.', false,
    'El local nuevo de marzo',
    'Hola Josefina,\n\nAbrir un local implica contratar a casi todo su equipo en pocas semanas, y la revisión de antecedentes suele ser lo que más se demora.\n\nEn Yago QA revisamos los antecedentes de cada postulante en minutos.\n\n¿Cuántas personas necesitan para el local de marzo?'),
  person(4, 'Rodrigo Fuentes', 'Jefe de Reclutamiento', 'Transportes Pehuén', 'Logística', 250, 'Temuco',
    'Transportes Pehuén mueve carga forestal y agrícola entre el Biobío y Los Lagos.', true,
    'Conductores en temporada de cosecha',
    'Hola Rodrigo,\n\nEn la cosecha, cada conductor que espera su revisión de antecedentes es un camión que no sale.\n\nEn Yago QA esa revisión toma minutos, con el respaldo de cada consulta.\n\n¿Cuántos conductores suman en la temporada?'),
  person(5, 'Constanza Vidal', 'Gerente de Personas', 'Tiendas Litoral', 'Retail', 350, 'Valparaíso',
    'Tiendas Litoral vende artículos para el hogar en 20 tiendas de la costa central.', false,
    'Vendedores para el verano en la costa',
    'Hola Constanza,\n\nEn la costa, el verano llena las tiendas y obliga a contratar rápido, justo cuando revisar antecedentes uno a uno más se nota.\n\nEn Yago QA lo hacemos en minutos para cada postulante.\n\n¿Cuántas personas suman para enero?'),
];
let saved = new Set();
const items = () => ITEMS.map((item, index) => saved.has(item.leadId) ? { ...item, savedLeadId: `demo-drop-lead-${index + 1}` } : item);

export default {
  id: 'contactos-de-la-semana', title: 'Contactos de la semana', start: '/dashboard',
  intro: 'Martes y viernes, cinco contactos nuevos con su correo: por qué te sirven, una investigación breve y un primer correo.',
  learn: ['Ver cómo se buscaron', 'Leer la investigación y el primer correo', 'Guardarlos sin gastar créditos'],
  mocks: [
    {
      url: '**/api/lead-drops/latest', method: 'GET',
      respond: (_body, request) => ({ scope: homeScope(request), drop: saved.size >= ITEMS.length ? null : { id: DROP_ID, dropDate: chileDay(), total: ITEMS.length, left: ITEMS.length - saved.size } }),
    },
    { url: `**/api/lead-drops/${DROP_ID}`, method: 'GET', respond: () => ({ id: DROP_ID, date: chileDay(), criteria: CRITERIA, items: items() }) },
    {
      url: `**/api/lead-drops/${DROP_ID}`, method: 'POST',
      respond: body => {
        const chosen = Array.isArray(body?.leadIds) ? body.leadIds : ITEMS.map(item => item.leadId);
        const fresh = chosen.filter(id => !saved.has(id));
        fresh.forEach(id => saved.add(id));
        return { saved: fresh.length, expired: 0, items: items() };
      },
    },
  ],
  scenes: [
    {
      title: 'Te esperan en «Hoy»', text: 'Martes y viernes, cinco contactos nuevos, elegidos para ti. También te llegan en el aviso de la mañana, con un PDF.',
      say: 'Martes y viernes, cinco contactos nuevos te esperan en Hoy.',
      before: async () => { saved = new Set(); },
      target: { role: 'link', name: 'Ver y guardar' }, zoomOn: { text: 'Contactos de la semana' }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Así los buscamos' },
    },
    {
      title: 'Así los buscamos', text: 'Con tu cliente ideal de «Perfil»: cargo, rubro y lugar. Solo correos verificados y nadie que tu equipo ya tenga.',
      say: 'Así los buscamos: con tu cliente ideal.', postit: 'Sin cliente ideal en «Perfil», usamos el de tu equipo.',
      target: { text: 'Así los buscamos' }, zoomOn: { css: 'section[aria-labelledby="drop-filters"]' }, action: 'none', zoom: 1.25,
    },
    {
      title: 'Por qué te sirve', text: 'Cada uno dice por qué calza contigo, y si trae teléfono.',
      say: 'Cada contacto dice por qué te sirve.',
      target: { text: ITEMS[0].why }, action: 'none', zoom: 1.4, arrow: true,
    },
    {
      title: 'Investigación y primer correo', text: 'Qué hace su empresa y un primer correo escrito para esa persona.',
      say: 'Ábrelo: la investigación y el primer correo.',
      target: { role: 'button', name: 'Investigación y primer correo' }, zoom: 1.4,
      waitFor: { text: 'Primer correo sugerido' },
    },
    {
      title: 'Listo para revisar', text: 'Escrito con tu oferta y tu firma de «Perfil». «Copiar» lo lleva a donde quieras.',
      say: 'Escrito con tu oferta, listo para revisar.', postit: 'El mismo texto viene en el PDF del correo.',
      target: { text: ITEMS[0].draft.subject }, zoomOn: { text: 'Primer correo sugerido' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Guárdalos sin créditos', text: 'Ya traen su correo verificado: pasan a «Por escribir» sin gastar créditos.',
      say: 'Guárdalos en Por escribir, sin gastar créditos.',
      target: { role: 'button', name: 'Guardar los 5 en «Por escribir»' }, zoom: 1.4, arrow: true,
      waitFor: { text: 'Quedaron 5 en «Por escribir», con su correo.' },
    },
    {
      title: 'Escríbeles', text: '«Escribirle» abre «Redactar» con el primer correo puesto. Si falta el teléfono, lo buscas en «Por escribir».',
      say: 'Y escríbeles con el borrador listo.',
      target: { role: 'link', name: 'Escribirle' }, action: 'hover', zoom: 1.4, arrow: true,
    },
  ],
  outro: { title: 'Cinco contactos, dos veces por semana', text: 'Ábrelos desde el correo o desde «Hoy».', items: ['Por qué te sirven', 'Investigación y primer correo', 'Guardarlos no gasta créditos'] },
};
