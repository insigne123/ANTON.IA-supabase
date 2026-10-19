const NAV = { role: 'navigation', name: 'Navegación principal' };
const DAY = 86_400_000;

// «Mercado público» reads ChileCompra's open data, which the bench does not have: its three parts are answered here with
// the shapes of /api/commercial-opportunities/demand, /contracts and /competitors. Made-up bodies and suppliers; the RUTs
// carry a wrong check digit on purpose, so none of them can be a real company.
const day = days => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const month = ahead => Math.min(12, new Date().getMonth() + 1 + ahead);
const year = new Date().getFullYear();

const line = (lineId, institution, institutionCode, description, amount, when, fit, reason) => ({
  lineId, institution, institutionCode, productCode: null, description, quantity: 1, unitAmount: amount, amount,
  month: when.quarter ? null : when, quarter: when.quarter ?? null, fit, reason,
});
const DEMAND = {
  available: true, year, updatedAt: new Date(Date.now() - 3 * DAY).toISOString(), job: null,
  keywords: ['verificación de antecedentes', 'evaluación psicolaboral', 'reclutamiento', 'selección de personal'],
  matches: [
    line('demo-l1', 'Servicio de Salud Valle Central', 'DEMO-1', 'Evaluaciones psicolaborales para concursos de personal', 36_000_000, month(1), 'alta', 'Evaluaciones psicolaborales para contratar: es lo que vendes.'),
    line('demo-l2', 'Servicio de Salud Valle Central', 'DEMO-1', 'Verificación de antecedentes del personal a honorarios', 18_500_000, month(2), 'alta', 'Revisión de antecedentes antes de contratar.'),
    line('demo-l3', 'Municipalidad de Valle Verde', 'DEMO-2', 'Asesoría para procesos de selección de personal', 24_000_000, { quarter: 4 }, 'media', 'Selección de personal: calza en parte con tu oferta.'),
    line('demo-l4', 'Corporación Municipal de Puerto Claro', 'DEMO-3', 'Plataforma de reclutamiento en línea por 12 meses', 15_000_000, month(1), 'alta', 'Reclutamiento en línea con revisión de candidatos.'),
  ],
};

const contract = (tenderId, code, name, agency, region, endsIn, amount, months, winnerName, winnerRut, fit, reason) => ({
  tenderId, code, name, agency, region, category: 'SERVICIOS DE RECURSOS HUMANOS', awardedOn: day(endsIn - months * 30), durationMonths: months,
  endsOn: day(endsIn), amount, currency: 'CLP', winnerRut, winnerName, winners: 1, fit, reason,
});
const CONTRACTS = {
  available: true, coverage: { available: true, to: day(-20).slice(0, 8) + '01' }, updatedAt: new Date(Date.now() - 2 * DAY).toISOString(), read: 412, job: null,
  contracts: [
    contract(9001, '4521-37-LE25', 'Servicio de evaluación psicolaboral para personal clínico', 'Hospital Regional de Bahía Azul', 'Región del Biobío', 38, 42_000_000, 12,
      'Psicolaboral Andes Limitada', '77888999-0', 'alta', 'Evaluación psicolaboral antes de contratar: lo mismo que ofreces.'),
    contract(9002, '2210-88-LE25', 'Verificación de antecedentes de postulantes', 'Servicio de Salud Valle Central', 'Región del Maule', 64, 27_500_000, 18,
      'Antecedentes del Pacífico SpA', '77345678-0', 'alta', 'Revisión de antecedentes laborales y judiciales de postulantes.'),
    contract(9003, '3301-12-LP24', 'Servicio externo de reclutamiento y selección', 'Universidad Regional del Sur', 'Región de Los Lagos', 112, 64_000_000, 24,
      'Selección Austral Limitada', '76987654-0', 'media', 'Reclutamiento y selección externalizados: calza en parte.'),
  ],
};

const supplier = (id, name, rut) => ({ id, name, rut });
const OWN = supplier(5001, 'Yago QA SpA', '76543210-0');
const FOLLOWED = supplier(5002, 'Antecedentes del Pacífico SpA', '77345678-0');
const WATCH = [supplier(5003, 'Psicolaboral Andes Limitada', '77888999-0'), supplier(5004, 'Talento Norte SpA', '77555111-0'), supplier(5005, 'Consultora Cordillera SpA', '76111222-0')];
const move = (code, name, agency, ago, won, amount) => ({ code, name, agency, publishedOn: day(-ago), status: won ? 'adjudicada' : 'cerrada', won, amount, currency: 'CLP' });
const RADAR = {
  available: true, coverage: { available: true, to: day(-20).slice(0, 8) + '01' },
  own: { ...OWN, bids: 14, wins: 5, awarded: 96_000_000, recent: [] }, ownRutMissing: false,
  followed: [{ ...FOLLOWED, bids: 38, wins: 13, awarded: 318_000_000, recent: [
    move('2210-41-LE26', 'Verificación de antecedentes para guardias', 'Municipalidad de Valle Verde', 12, true, 21_400_000),
    move('1180-09-L126', 'Evaluación de idoneidad de postulantes', 'Servicio de Salud Valle Central', 40, false, null),
  ] }],
  suggestions: { basis: 'cobidders', items: [
    { ...WATCH[0], shared: 6, wins: 9 }, { ...WATCH[1], shared: 4, wins: 5 }, { ...WATCH[2], shared: 3, wins: 2 },
  ] },
};
const PROFILE = {
  supplier: WATCH[0], bids: 64, wins: 19, awarded: 412_000_000, medianOfferRatio: 0.87,
  agencies: [{ name: 'Hospital Regional de Bahía Azul', bids: 9, wins: 4 }, { name: 'Servicio de Salud Valle Central', bids: 7, wins: 3 }, { name: 'Universidad Regional del Sur', bids: 5, wins: 1 }],
  categories: [{ name: 'Servicios de recursos humanos', bids: 41, wins: 14 }, { name: 'Capacitación', bids: 15, wins: 4 }, { name: 'Asesorías', bids: 8, wins: 1 }],
  recent: [
    { code: '4521-37-LE25', name: 'Servicio de evaluación psicolaboral para personal clínico', agency: 'Hospital Regional de Bahía Azul', publishedOn: day(-330), status: 'adjudicada', estimatedAmount: 48_000_000, currency: 'CLP', offered: 42_000_000, won: true },
    { code: '3301-55-LE26', name: 'Evaluaciones psicolaborales para concurso docente', agency: 'Universidad Regional del Sur', publishedOn: day(-70), status: 'cerrada', estimatedAmount: 30_000_000, currency: 'CLP', offered: 27_900_000, won: false },
    { code: '2210-60-L126', name: 'Aplicación de test psicolaborales', agency: 'Servicio de Salud Valle Central', publishedOn: day(-25), status: 'adjudicada', estimatedAmount: 9_000_000, currency: 'CLP', offered: 7_700_000, won: true },
  ],
};

export default {
  id: 'mercado-publico', title: 'Mercado público', start: '/dashboard',
  intro: 'Lo que el Estado planea comprar, los contratos que van a licitarse de nuevo y quién compite contigo.',
  learn: ['Ver la demanda futura', 'Llegar antes a los contratos por vencer', 'Vigilar a tus competidores'],
  mocks: [
    { url: /\/api\/commercial-opportunities\/demand$/, method: 'GET', respond: DEMAND },
    { url: /\/api\/commercial-opportunities\/contracts$/, method: 'GET', respond: CONTRACTS },
    {
      url: /\/api\/commercial-opportunities\/competitors(\?.*)?$/, method: 'GET',
      respond: (_body, request) => {
        const params = new URL(request.url()).searchParams;
        if (params.has('id')) return PROFILE;
        if (params.has('q')) return { items: WATCH };
        return RADAR;
      },
    },
  ],
  scenes: [
    {
      title: 'Abre Oportunidades', text: 'Está en el menú, en «Prospectar». Mercado público es para quien administra.',
      say: 'Abre Oportunidades desde el menú.',
      target: { role: 'link', name: 'Oportunidades', within: NAV },
      waitFor: { role: 'button', name: 'Mercado público' },
    },
    {
      title: 'Mercado público', text: 'Tres partes: demanda futura, contratos por vencer y competidores.',
      say: 'Entra a «Mercado público».',
      target: { role: 'button', name: 'Mercado público' }, zoom: 1.6, arrow: true,
      waitFor: { role: 'heading', name: /^Demanda futura/, exact: false },
    },
    {
      title: 'Lo que planean comprar', text: 'Del Plan Anual de Compras de cada organismo, solo lo que calza con tu oferta.',
      say: 'Lo que el Estado planea comprar y calza contigo.', postit: 'Se actualiza solo cada mes.',
      target: { text: /por comprar de aquí a fin de año/, exact: false }, zoomOn: { css: '[aria-labelledby="demand-title"] ul' }, action: 'none', zoom: 1.2,
    },
    {
      title: 'Llega antes', text: 'Monto y mes estimados. «Seguir» la suma a tus oportunidades para prepararte.',
      say: 'Síguela y prepárate antes de que la liciten.',
      target: { role: 'button', name: 'Seguir: Evaluaciones psicolaborales para concursos de personal' }, action: 'hover', zoom: 1.5, arrow: true,
    },
    {
      title: 'Contratos por vencer', text: 'Contratos que hoy tiene otra empresa y terminan pronto: se licitarán de nuevo.',
      say: 'En «Contratos por vencer», lo que se licitará otra vez.',
      target: { role: 'tab', name: 'Contratos por vencer' }, zoom: 1.6,
      waitFor: { role: 'heading', name: 'Contratos por vencer' },
    },
    {
      title: 'Quién lo tiene y cuándo vence', text: 'El organismo, la empresa que lo tiene, el monto y el plazo.',
      say: 'Quién lo tiene, por cuánto y cuándo vence.', postit: 'Conversa con el área antes de que publique la nueva licitación.',
      target: { role: 'heading', name: 'Servicio de evaluación psicolaboral para personal clínico' }, zoomOn: { role: 'list' }, action: 'none', zoom: 1.2,
    },
    {
      title: 'Competidores', text: 'Quién compite contigo en licitaciones públicas, cuánto gana y dónde.',
      say: 'En «Competidores», a quién te enfrentas.',
      target: { role: 'tab', name: 'Competidores' }, zoom: 1.6,
      waitFor: { role: 'heading', name: 'Competidores', exact: true },
    },
    {
      title: 'Tu empresa y los que sigues', text: 'Tus ofertas y las de tus competidores en el último año, con lo que ganaron.',
      say: 'Tu historial y el de los que sigues.',
      target: { role: 'heading', name: /^Los que sigues/, exact: false }, zoomOn: { role: 'heading', name: 'Tu empresa en licitaciones públicas' }, action: 'none', zoom: 1.15,
    },
    {
      title: 'Para vigilar', text: 'Ofertaron en las mismas licitaciones que tu empresa. Abre su perfil.',
      say: 'Abre el perfil de un competidor.',
      target: { role: 'button', name: 'Ver perfil de Psicolaboral Andes Limitada' }, zoom: 1.5, arrow: true,
      waitFor: { role: 'dialog', name: 'Psicolaboral Andes Limitada' },
    },
    {
      title: 'Su perfil', text: 'Dónde oferta, qué vende, cuánto suele ofertar y sus últimas licitaciones.',
      say: 'Dónde oferta, qué vende y a qué precio.', postit: '«Seguir» te muestra cada mes lo que gana.',
      target: { role: 'dialog', name: 'Psicolaboral Andes Limitada' }, action: 'none', zoom: 1.15, highlight: false,
    },
  ],
  outro: {
    title: 'Llega antes que los demás', text: 'Revisa Mercado público una vez al mes.',
    items: ['Demanda futura del Plan de Compras', 'Contratos que se licitarán de nuevo', 'Competidores y sus precios'],
  },
};
