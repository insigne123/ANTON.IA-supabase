// A company that is hiring and a LinkedIn post, with the report the AI writes for each: what the commercial sheet tests and the
// screenshots of the page and the PDF are made from. The company, its ads and its people are invented.
import type { OpportunityReport } from './expedient';
import type { CommercialBrief } from './signal-brief';
import type { SheetInput } from './signal-sheet';

export const NOW = Date.parse('2026-10-22T15:00:00Z');
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

export const hiringItem = (): SheetInput['item'] => ({
  kind: 'hiring', title: 'Actividad de contratación: Retail Pacífico', company_name: 'Retail Pacífico', company_domain: 'retailpacifico.cl',
  company_linkedin_url: 'https://www.linkedin.com/company/retail-pacifico', url: 'https://retailpacifico.cl', score: 75,
  reasons: ['41 avisos en 30 días (32 en la última semana)', 'cargos: reponedor (14), operario (8), bodeguero (7)', "en Metropolitana y O'Higgins", 'ya tienes contactos ahí'],
  data: {
    ads: 41, size: null, windowDays: 30, adsLastWeek: 32, isClient: false, isContact: true, industry: 'Retail', sources: ['jsearch'], publishers: ['BeBee', 'Computrabajo', 'Trabajando.com', 'Postula Retail'],
    firstPostedAt: at(-27), lastPostedAt: at(-2), matchedService: 'Servicios transitorios y outsourcing logístico', evaluation: 'recommended',
    roles: [{ role: 'reponedor', ads: 14 }, { role: 'operario', ads: 8 }, { role: 'bodeguero', ads: 7 }, { role: 'peoneta', ads: 5 }, { role: 'vendedor', ads: 4 }, { role: 'cajero', ads: 2 }, { role: 'conductor', ads: 1 }],
    regions: [{ region: 'Metropolitana', ads: 19 }, { region: "O'Higgins", ads: 4 }, { region: 'Biobío', ads: 2 }, { region: 'Maule', ads: 1 }, { region: 'Ñuble', ads: 1 }],
    evidence: [
      { url: 'https://example.com/avisos/1', title: 'Reponedor nocturno para supermercado, Maipú. Turnos continuos', source: 'jsearch', location: 'Maipú, Región Metropolitana, CL', postedAt: at(-2), publisher: 'BeBee' },
      { url: 'https://example.com/avisos/2', title: 'Operador perecedero (reponedor), La Reina. Horario rotativo', source: 'jsearch', location: 'La Reina, Región Metropolitana, CL', postedAt: at(-2), publisher: 'Computrabajo' },
      { url: 'https://example.com/avisos/3', title: 'Bodeguero logístico turno AM, Maipú', source: 'jsearch', location: 'Maipú, Región Metropolitana, CL', postedAt: at(-4), publisher: 'Computrabajo' },
      { url: 'javascript:alert(1)', title: 'Peoneta, ruta Rancagua', source: 'jsearch', location: "Rancagua, O'Higgins, CL", postedAt: at(-6), publisher: 'Trabajando.com' },
      { url: 'https://example.com/avisos/5', title: 'Vendedor/a de tienda, Concepción', source: 'jsearch', location: 'Concepción, Biobío, CL', postedAt: at(-9), publisher: 'Postula Retail' },
    ],
    summary: { text: 'Cadena de retail que está reforzando tiendas y centros de distribución en la Región Metropolitana.', model: 'claude-haiku-5-5', basis: 'ficha', at: at(-1) },
  },
});

export const postItem = (): SheetInput['item'] => ({
  kind: 'linkedin_post', title: 'Buscamos 30 conductores para nuestro nuevo centro de distribución', company_name: 'Norte Sur Transportes', score: 62, reasons: ['Contratación masiva de conductores'],
  url: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/',
  data: {
    description: 'Buscamos 30 conductores clase A4 para nuestro nuevo centro de distribución en Quilicura. Si conoces a alguien o tu empresa presta servicios de transporte, escríbenos por mensaje privado.',
    observed: { postedAt: at(-3), authorUrl: 'https://www.linkedin.com/in/ana-perez?miniProfileUrn=urn%3Ali%3Afsd_profile%3AABC', authorType: 'profile', signalType: 'post', truncated: false, authorshipVerified: false },
    matchedService: 'Servicios transitorios', summary: { text: 'Norte Sur Transportes busca 30 conductores para su nuevo centro de distribución.', model: 'claude-haiku-5-5', basis: 'texto', at: at(-1) },
  },
});

export const brief = (): CommercialBrief => ({
  headline: 'Ofrecerles refuerzos de bodega y reposición mientras cierran sus procesos propios: 32 avisos en la última semana.',
  whyNow: ['32 de los 41 avisos de 30 días son de la última semana: la contratación se aceleró.', 'Reponedor, operario y bodeguero suman 29 avisos: es lo que cubre tu outsourcing logístico.', '19 avisos están en la Región Metropolitana, donde ya tienes contactos.'],
  fit: { services: [
    { service: 'Outsourcing logístico', why: 'Bodega, inventario, recepción y despacho: 15 avisos de bodeguero y operario.', strength: 'strong' },
    { service: 'Servicios transitorios', why: 'Reponedores y peonetas para picos de venta: 19 avisos.', strength: 'strong' },
    { service: 'Reclutamiento y selección', why: 'Podrían tercerizar parte del proceso, pero publican por su cuenta.', strength: 'weak' },
  ], gaps: ['No hay casos propios en retail para citar.', 'No se sabe si tienen un proveedor homologado.'] },
  company: { summary: 'Cadena de autoservicio con tiendas en la Región Metropolitana y O\'Higgins y un centro de distribución en el sur de Santiago. Rubro retail; el tamaño no viene informado.',
    facts: [{ label: 'Rubro', value: 'Retail' }, { label: 'Centro de distribución', value: 'Sur de Santiago' }, { label: 'Contratación', value: 'Reponedores, bodegueros y operarios' }] },
  buyers: [
    { title: 'Gerente de Operaciones', why: 'Dueño de la dotación de tiendas y bodegas.', priority: 'primary' },
    { title: 'Gerente de Personas', why: 'Lleva los procesos de contratación.', priority: 'primary' },
    { title: 'Gerente de Logística', why: 'Responsable del centro de distribución.', priority: 'secondary' },
    { title: 'Jefe de Compras de servicios', why: 'Homologa proveedores externos.', priority: 'secondary' },
  ],
  approach: { angle: 'Apoyar la dotación de bodega y reposición en las comunas con más avisos, con refuerzos rápidos mientras cierran sus procesos propios.',
    hooks: ['32 avisos en una semana', 'Turnos continuos y nocturnos en Maipú y La Reina', 'Bodegueros logísticos en el centro de distribución'], avoid: ['No prometer precios ni cobertura sin validar capacidad.', 'No decir que sabes que necesitan un proveedor: un aviso no lo prueba.'] },
  messages: [
    { channel: 'linkedin', subject: '', body: 'Hola [nombre], vi que Retail Pacífico abrió 32 avisos de reposición y bodega esta semana. Apoyamos con refuerzos de personal en Santiago. ¿Te cuento en 10 minutos?' },
    { channel: 'email', subject: 'Refuerzos de bodega y reposición para Retail Pacífico', body: 'Hola [nombre],\n\nVimos que Retail Pacífico tiene 41 avisos abiertos en 30 días, 32 de ellos esta semana, sobre todo reponedores y bodegueros en la Región Metropolitana.\n\nApoyamos a empresas de retail con personal para refuerzos y reemplazos, sin que tengan que sumar procesos de selección.\n\n¿Podemos conversar 15 minutos para ver si hoy externalizan parte de esta dotación?\n\nSaludos,\n[tu nombre]' },
    { channel: 'call', subject: '', body: 'Hola [nombre], soy [tu nombre] de [tu empresa]. Te llamo porque vi que están reforzando bodega y reposición en Santiago. ¿Tienes 30 segundos para ver si te sirve que te cuente cómo apoyamos en picos?' },
  ],
  cadence: [
    { day: 0, channel: 'research', action: 'Buscar a Operaciones y Personas en LinkedIn' }, { day: 1, channel: 'linkedin', action: 'Enviar la nota de conexión a 2 o 3 personas' },
    { day: 3, channel: 'email', action: 'Enviar el correo a quien aceptó la conexión' }, { day: 7, channel: 'call', action: 'Llamar al gerente de Operaciones' },
    { day: 10, channel: 'email', action: 'Seguimiento con un caso de bodega' }, { day: 17, channel: 'linkedin', action: 'Último mensaje corto y cierre' },
  ],
  objections: [
    { objection: 'Ya tenemos un proveedor homologado', answer: 'Ofrecerse como respaldo en picos y reemplazos, sin sustituirlo, y pedir el proceso de homologación.' },
    { objection: 'Contratamos directo y nos sale más barato', answer: 'Comparar el costo total de selección, ausentismo y reemplazo en los meses de mayor rotación, sin prometer un precio hoy.' },
    { objection: 'No tenemos presupuesto para externalizar', answer: 'Proponer un piloto de un mes en una tienda o bodega, con alcance y salida claros.' },
  ],
});

export const report = (withBrief = true): OpportunityReport => ({
  kind: 'hiring', title: 'Ficha comercial — Retail Pacífico', generatedAt: at(-0.1), recommendation: 'conditional',
  executive: 'Falta información para decidir, pero vale un primer contacto de bajo costo. Retail Pacífico publicó 41 avisos en 30 días, 32 de ellos en la última semana, sobre todo reponedores y bodegueros en la Región Metropolitana. Un aviso es una señal, no prueba de que contraten externos.',
  reasons: ['Hay 41 avisos en 30 días, 32 en la última semana.', 'Los cargos calzan con outsourcing logístico y servicios transitorios.', 'Ya tienes contactos ahí.'],
  nextSteps: ['Identificar en LinkedIn a decisores de Operaciones, Personas y Logística esta semana.', 'Enviar el primer mensaje a 2 o 3 contactos.', 'Reunir casos y capacidad por comuna para la primera reunión.'],
  sections: [
    { id: 's5', title: 'Cómo abordarlos: ángulo y primer mensaje', paragraphs: ['Ángulo: apoyar la dotación de bodega y reposición en las zonas con más avisos, con refuerzos rápidos mientras cierran sus procesos propios.',
      'Mensaje propuesto: «Hola [nombre], vimos que Retail Pacífico tiene varios avisos abiertos de reponedores y bodegueros en la Región Metropolitana, 32 solo esta semana. ¿Podemos conversar 15 minutos para ver si hoy externalizan parte de esta dotación?»'], facts: [] },
  ],
  requirements: [
    { title: 'Confirmar que externalizan dotación de bodega y reposición', status: 'unknown', evidence: [], action: 'Preguntarlo en la primera conversación.', role: 'Ejecutivo comercial', due: '' },
    { title: 'Identificar al decisor y el proceso de homologación de proveedores', status: 'unknown', evidence: [], action: 'Buscar en LinkedIn a Operaciones y Personas.', role: 'Ejecutivo comercial', due: '' },
  ],
  tasks: [{ title: 'Buscar decisores de Operaciones y Personas', role: 'Ejecutivo comercial', due: 'Esta semana', dependency: '', evidence: 'Lista de 3 contactos' }],
  milestones: [], risks: [{ title: 'Los avisos son dotación propia, no un servicio por contratar', impact: 'high', basis: 'proposed', mitigation: 'Preguntar abiertamente por su modelo de dotación antes de preparar una propuesta.', citations: [] }],
  scenarios: [], questions: ['¿Cubren hoy bodega y reposición con dotación propia o con empresas externas?', '¿Qué tiendas o centros tienen más presión de dotación?', '¿Cómo se homologa un proveedor de servicios de personal?', '¿Quién decide la contratación de servicios externos en esta área?'],
  warnings: ['No hay contactos con nombre ni datos verificados; hay que buscarlos en LinkedIn.', 'No hay precios, costos ni margen: se necesitan para cotizar.'],
  coverage: [], sources: [], route: null, reviewers: [], ...(withBrief ? { commercial: brief() } : {}),
});
