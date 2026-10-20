import { DEMO_COMPANIES, searchMocks } from './demo-data.mjs';

const NAV = { role: 'navigation', name: 'Navegación principal' };
// «Empresas parecidas»: the search answers with the demo companies (demo-data.mjs) and the AI's choice is answered here,
// with the same shape as POST /api/crm/companies/similar.
const WHY = {
  'Retail Pacífico': 'Cadena de tiendas como Retail Andino, con contratación masiva en temporada alta y equipos de personas por región.',
  'Andes Food': 'Contrata mucho personal de bodega y sala, como tus clientes de retail, y su tamaño es parecido.',
};

export default {
  id: 'empresas', title: 'Empresas', start: '/dashboard',
  intro: 'Tus contactos agrupados por empresa: a quién conoces, quién falta para cada venta y empresas parecidas.',
  learn: ['Ver quién decide, quién lo usa y quién paga', 'Buscar a quien falta', 'Encontrar empresas parecidas'],
  mocks: [...searchMocks, {
    // What the company does, as GET /api/crm/companies/about answers it from the company's website.
    url: '**/api/crm/companies/about?*', method: 'GET',
    respond: (_body, request) => {
      const domain = new URL(request.url()).searchParams.get('domain') || 'retailandino.cl';
      return { domain, website: `https://${domain}`, about: 'Cadena de tiendas de vestuario y hogar con locales en el norte de Chile y venta en línea.' };
    },
  }, {
    url: '**/api/crm/companies/similar', method: 'POST',
    respond: body => {
      const picks = (body?.candidates || []).filter(candidate => WHY[candidate.name]).map(candidate => ({ ...candidate, why: WHY[candidate.name] }));
      return { companies: picks.length ? picks : DEMO_COMPANIES.slice(0, 2).map(org => ({ id: org.id, name: org.name, industry: org.industry, size: org.estimated_num_employees, city: org.city, country: org.country, why: WHY[org.name] || null })) };
    },
  }],
  scenes: [
    {
      title: 'Abre el Pipeline', text: 'Está en el menú, en «Seguimiento».',
      say: 'Abre el Pipeline desde el menú.',
      target: { role: 'link', name: 'Pipeline', within: NAV },
      waitFor: { role: 'button', name: 'Empresas', exact: true },
    },
    {
      title: 'Tus empresas', text: 'La tercera vista: tus contactos agrupados por empresa.',
      say: 'Pasa a «Empresas».',
      target: { role: 'button', name: 'Empresas', exact: true }, zoom: 1.5, arrow: true,
      waitFor: { role: 'heading', name: 'Empresas', exact: true },
    },
    {
      title: 'Decide, Usa, Paga', text: 'Una venta suele necesitar a quien decide, a quien lo usa y a quien paga. Lleno: ya conoces a alguien.',
      say: 'Cada empresa dice a quién ya conoces.', postit: 'Arriba, los negocios abiertos; después, los ganados.',
      target: { role: 'button', name: /Retail Andino/, exact: false }, action: 'none', zoom: 1.4, arrow: true,
    },
    {
      title: 'Abre una empresa', text: 'Qué hace según su sitio web, su gente, lo que falta para la venta y empresas parecidas.',
      say: 'Ábrela para ver el detalle.',
      target: { role: 'button', name: /Retail Andino/, exact: false }, zoom: 1.4,
      waitFor: { role: 'dialog', name: 'Retail Andino' },
    },
    {
      title: 'Para esta venta', text: 'Lo que falta trae «Buscar», con la empresa y los cargos listos en Buscar prospectos.',
      say: 'Si falta alguien, búscalo desde aquí.', postit: 'Los cargos salen de «Cargos que buscas» en tu Perfil.',
      target: { role: 'heading', name: 'Para esta venta' }, zoomOn: { css: 'section[aria-labelledby="company-committee"]' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Dónde conoces gente', text: 'Cada fila es un área y cada columna un nivel: «—» es donde aún no conoces a nadie.',
      say: 'Y en qué áreas y niveles conoces gente.',
      target: { role: 'heading', name: 'Dónde conoces gente' }, zoomOn: { css: 'section[aria-labelledby="company-coverage"]' }, action: 'none', zoom: 1.3,
    },
    {
      title: 'Empresas parecidas', text: 'Del mismo rubro y tamaño, que aún no están en tu CRM. La IA dice por qué se parecen.',
      say: 'Busca empresas parecidas a las que ya trabajas.', postit: 'Usa una búsqueda de tu cupo diario.',
      target: { role: 'button', name: 'Buscar empresas parecidas' }, zoom: 1.5, arrow: true,
      waitFor: { text: 'Retail Pacífico', exact: true },
    },
    {
      title: 'Por qué se parecen', text: '«Ver personas» abre Buscar prospectos en esa empresa, con los cargos que necesitas.',
      say: 'Cada una dice por qué se parece.',
      target: { text: 'Retail Pacífico', exact: true }, zoomOn: { text: WHY['Retail Pacífico'] }, action: 'none', zoom: 1.3,
    },
  ],
  outro: {
    title: 'Conoce a toda la empresa', text: 'Una venta avanza cuando conoces a quien decide, a quien lo usa y a quien paga.',
    items: ['Decide, Usa, Paga en cada empresa', '«Buscar» a quien falta', 'Empresas parecidas con su porqué'],
  },
};
