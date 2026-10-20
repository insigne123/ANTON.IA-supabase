import { uid } from '../../visual-audit/fixtures/ids.mjs';
import { fileURLToPath } from 'node:url';
import { opportunityData } from './oportunidades-data.mjs';

const NAV = { role: 'navigation', name: 'Navegación principal' };
const TITLE = 'Servicio de verificación de antecedentes de postulantes';
// Playwright cannot hand the file chooser a name with accents: the fixture's name has none.
const INVITATION = fileURLToPath(new URL('../fixtures/Solicitud de presupuesto.pdf', import.meta.url));
// The same ids as the demo data of the bench (visual-audit/fixtures/ids.mjs).
const data = () => opportunityData({ ORG: uid(1), OWNER: uid(11), MEMBER: uid(12) });

export default {
  id: 'oportunidades', title: 'Oportunidades', start: '/dashboard',
  // Two minutes of screens: a little more compression keeps it under 4 MB (tutorial-videos.test.ts).
  crf: 33,
  intro: 'Licitaciones, Compra Ágil y empresas que están contratando, con un informe de la IA para decidir y ganar.',
  learn: ['Leer el embudo', 'Cargar una desde su documento', 'Abrir una licitación y su informe', 'Ver cómo ganarla'],
  mocks: [
    {
      url: /\/api\/commercial-opportunities\/workspace\?/, method: 'GET',
      respond: (_body, request) => (new URL(request.url()).searchParams.get('view') === 'pipeline' ? data().pipeline : data().overview),
    },
    { url: /\/api\/commercial-opportunities\/workspace\/prefill$/, method: 'POST', respond: () => data().prefill },
    { url: /\/api\/commercial-opportunities\/workspace$/, method: 'POST', respond: { ok: true, suggestions: [] } },
    { url: /\/api\/commercial-opportunities\/[^/?]+\/workspace$/, method: 'GET', respond: () => data().detail },
    { url: /\/api\/commercial-opportunities\/[^/?]+\/market$/, method: 'GET', respond: () => data().market },
    { url: /\/api\/commercial-opportunities\/[^/?]+\/chat$/, method: 'GET', respond: { messages: [] } },
    { url: /\/api\/commercial-opportunities\/[^/?]+\/contacts/, method: 'GET', respond: { contacts: [] } },
    {
      url: /\/api\/commercial-opportunities\/[^/?]+\/sources$/, method: 'GET',
      respond: { links: { ficha: 'https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=4521-61-LE26', attachments: null, forum: null, forms: 1, code: '4521-61-LE26' } },
    },
    { url: /\/api\/commercial-opportunities\/assistant/, method: 'GET', respond: () => data().assistant },
  ],
  scenes: [
    {
      title: 'Abre Oportunidades', text: 'Está en el menú, en «Prospectar».',
      say: 'Abre Oportunidades desde el menú.',
      target: { role: 'link', name: 'Oportunidades', within: NAV },
      waitFor: { role: 'heading', name: 'Embudo de oportunidades' },
    },
    {
      title: 'El embudo', text: 'De «Por revisar» a «Ganadas». Cada oportunidad avanza sola cuando el trabajo lo muestra.',
      say: 'El embudo te dice dónde está cada oportunidad.',
      target: { role: 'heading', name: 'Embudo de oportunidades' }, zoomOn: { css: 'section[aria-labelledby="pipeline-title"]' }, action: 'none', zoom: 1.1, highlight: false,
    },
    {
      title: 'Busca y filtra', text: 'Por nombre, organismo o empresa, y por fuente: licitaciones, Compra Ágil, LinkedIn o recibidas. «Cargar más» trae las siguientes.',
      say: 'Busca y elige la fuente.',
      target: { role: 'group', name: 'Fuente' }, action: 'none', zoom: 1.5, arrow: true,
    },
    {
      title: 'Sugerir próximos pasos', text: 'Con oportunidades en curso, la IA propone a qué etapa moverlas y qué hacer después. Nada cambia sin que lo aceptes.',
      say: 'La IA te sugiere los próximos pasos.',
      target: { role: 'button', name: 'Sugerir próximos pasos' }, action: 'hover', zoom: 1.6, arrow: true,
    },
    {
      title: 'De qué se trata', text: 'Bajo cada nombre, la IA resume la oportunidad en una frase.',
      say: 'Cada tarjeta te dice de qué se trata.',
      target: { text: /^Plataforma para publicar cargos/, exact: false }, zoomOn: { css: 'li:has(p:has-text("Plataforma de reclutamiento"))' }, action: 'none', zoom: 1.35,
    },
    {
      title: 'Carga una que recibiste', text: 'Sube la invitación, las bases o el correo.',
      say: 'Si te llega una invitación, súbela.',
      // Without zoom: the dialog opens in the middle of the window, away from the button.
      target: { role: 'button', name: 'Cargar oportunidad' }, zoom: 1, arrow: true,
      waitFor: { text: 'Sube la invitación, las bases o el correo' },
    },
    {
      title: 'La IA completa el formulario', text: 'Lee el documento y llena los datos. Tú los revisas antes de guardar.',
      say: 'La IA llena el formulario por ti.',
      target: { text: 'Elegir documento' }, zoomOn: { role: 'dialog' }, upload: INVITATION, zoom: 1.05,
      waitFor: { text: /^Completamos el formulario con/, exact: false },
      after: async frame => { await frame.getByRole('dialog').evaluate(node => node.scrollTo({ top: 0 })); },
    },
    {
      title: 'Revisa y guarda', text: 'Dice qué no encontró, y el documento queda en «Bases y anexos».',
      say: 'Revisas lo que encontró y guardas.',
      target: { text: /^Completamos el formulario con/, exact: false }, zoomOn: { role: 'dialog' }, action: 'none', zoom: 1.05,
    },
    {
      title: 'La lista', text: 'Las recomendadas primero: calzan con tu oferta y aún no tienen equipo.',
      say: 'En «Lista», las que calzan contigo.',
      // The form of the scene before stays open while it is read; it closes here, without saving.
      before: async frame => { await frame.getByRole('button', { name: 'Cancelar' }).click(); await frame.getByRole('dialog').waitFor({ state: 'hidden' }); },
      target: { role: 'button', name: 'Lista', within: { role: 'group', name: 'Vista' } }, zoom: 1.6, arrow: true,
      waitFor: { role: 'heading', name: TITLE },
    },
    {
      title: 'Por qué calza', text: 'El motivo, el cierre, el monto y quién la trabaja.',
      say: 'Cada una dice por qué calza contigo.', postit: 'Las encontramos cada mañana con tu oferta: no escribes palabras de búsqueda.',
      target: { role: 'heading', name: TITLE }, zoomOn: { css: `article:has(h3:has-text("${TITLE}"))` }, action: 'none', zoom: 1.4,
    },
    {
      title: 'Ábrela', text: 'El expediente: informe, cómo postular, cómo ganar, documentos y tareas.',
      say: 'Ábrela para trabajarla.',
      target: { css: `article:has(h3:has-text("${TITLE}")) button` }, zoom: 1.5, arrow: true,
      waitFor: { text: 'Postular', exact: true },
    },
    {
      title: 'El informe', text: 'La IA leyó las bases: si conviene postular, por qué y qué hacer ahora.',
      say: 'El informe te dice si conviene postular.', postit: 'Solo dice «No postular» con evidencia de las bases.',
      target: { text: 'Postular', exact: true }, zoomOn: { text: /^Postular\. El hospital/, exact: false }, action: 'none', zoom: 1.35,
    },
    {
      title: 'Requisitos', text: 'Lo que ya cumples y lo que falta, con quién y para cuándo.',
      say: 'Lo que piden y lo que te falta.',
      target: { role: 'heading', name: /^Requisitos para postular/, exact: false }, action: 'none', zoom: 1.3, arrow: true,
    },
    {
      title: 'Cómo ganar', text: 'Lo que este organismo compró antes, quién ganó y a qué precio.',
      say: 'En «Cómo ganar», el historial del organismo.',
      target: { role: 'button', name: 'Cómo ganar' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'heading', name: 'Estrategia sugerida' },
    },
    {
      title: 'Un precio con respaldo', text: 'El rango sale de lo que realmente se pagó en compras parecidas.',
      say: 'Un rango de precio apoyado en lo que se pagó.', postit: 'Datos abiertos de ChileCompra de los últimos 4 años.',
      target: { text: 'Rango de precio' }, zoomOn: { css: 'section[aria-labelledby="winplan-title"]' }, action: 'none', zoom: 1.15,
    },
    {
      title: 'A quién tendrás enfrente', text: 'Quién ganó antes en este organismo y qué destacar en tu oferta.',
      say: 'Y a quién tendrás enfrente.',
      target: { role: 'heading', name: 'A quién tendrás enfrente' }, action: 'none', zoom: 1.4, arrow: true,
    },
    {
      title: 'Pregúntale a la IA', text: 'Responde con las bases de esta licitación y cita de dónde lo sacó.',
      say: 'Y si tienes dudas, pregúntale a la IA.',
      target: { role: 'button', name: 'Preguntar a la IA' }, action: 'hover', zoom: 1.6, arrow: true,
    },
  ],
  outro: {
    title: 'Oportunidades cada mañana', text: 'Revisa las recomendadas y trabaja las que calzan.',
    items: ['El embudo, con un resumen de cada una', 'Cargar una desde su documento', 'El informe: postular o no, y por qué', '«Cómo ganar» con el historial del organismo'],
  },
};
