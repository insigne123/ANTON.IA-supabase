import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_SEARCH_NOTICE, normalizeCoworkSearchResult, omittedSearchNote, runCoworkSearch, withoutOwnCompanyAndCompetitors } from './external-search';
import { companyRelator } from '@/lib/server/company-relations';

// Apollo's company search on 6 Nov 2026 (fictional companies): no industry, headcount or city, sometimes the activity codes.
test('company results take the sector from the activity codes and say what Apollo does not bring', () => {
  const result = normalizeCoworkSearchResult({ organizations: [
    { id: 'org1', name: 'Hotel del Puerto', primary_domain: 'hoteldelpuerto.cl', naics_codes: ['721110'] },
    { id: 'org2', name: 'Transportes Sur', primary_domain: 'transportessur.cl', sic_codes: ['4213'] },
    { id: 'org3', name: 'Sin Códigos SpA', primary_domain: null },
    { id: 'org4', name: 'Con Rubro', industry: 'hospitality', naics_codes: ['484121'], estimated_num_employees: 120, city: 'Concepción', country: 'Chile' },
  ] }, 25, 'companies') as any;
  assert.deepEqual(result.items.map((item: any) => item.industry), ['Hotelería y alojamiento', 'Transporte y logística', null, 'hospitality']);
  assert.equal(result.items[3].employees, 120);
  assert.equal(result.items[3].location, 'Concepción, Chile');
  assert.equal(result.notice, COMPANY_SEARCH_NOTICE);
  assert.match(result.notice, /no entrega el rubro, la dotación ni la ciudad/);
});

// The sector of the companies Apollo gives none, estimated by an AI (src/lib/server/company-sectors.ts), with a classifier stand-in.
const estimated = (sectors: Record<string, string>) => {
  const asked: Array<{ companies: Array<{ key: string; name: string; domain?: string | null }>; country?: string }> = [];
  const classify = async (companies: Array<{ key: string; name: string; domain?: string | null }>, options?: { country?: string }) => {
    asked.push({ companies, country: options?.country });
    return new Map(companies.filter(company => sectors[company.key]).map(company => [company.key, { sector: sectors[company.key], certainty: 'alta' as const, via: 'sitio' as const }]));
  };
  return { asked, classify };
};

test('a company search asks the AI only for the companies without a sector, and says which sectors it estimated', async () => {
  const { asked, classify } = estimated({ org3: 'Seguridad e investigaciones' });
  const result = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Seguridad'], locations: [], companyLocations: ['Lima, Perú'], limit: 25 },
    'user-1', async () => ({ organizations: [
      { id: 'org1', name: 'Hotel del Puerto', primary_domain: 'hoteldelpuerto.cl', naics_codes: ['721110'] },
      { id: 'org3', name: 'Vigilancia Andina', primary_domain: 'vigilanciaandina.pe', website_url: 'https://www.vigilanciaandina.pe' },
      { id: 'org5', name: 'Grupo Sin Pistas', website_url: 'https://gruposinpistas.pe/inicio' },
    ] }), classify) as any;
  assert.deepEqual(asked, [{ country: 'PE', companies: [
    { key: 'org3', name: 'Vigilancia Andina', domain: 'vigilanciaandina.pe', location: null },
    { key: 'org5', name: 'Grupo Sin Pistas', domain: 'gruposinpistas.pe', location: null },
  ] }]);
  assert.deepEqual(result.items.map((item: any) => [item.industry, item.industryEstimated ?? false]),
    [['Hotelería y alojamiento', false], ['Seguridad e investigaciones', true], [null, false]]);
  assert.match(result.notice, /lo estimó una IA con su sitio web/);
});

test('a people search fills the sector of each person\'s company, and the reason of fit says it', async () => {
  const { asked, classify } = estimated({ 'id:o1': 'Construcción' });
  const result = await runCoworkSearch({ strategy: 'people', titles: ['Gerente de Personas'], industries: ['Construcción'], locations: ['Chile'], limit: 25 },
    'user-1', async () => ({ leads: [
      { id: 'p1', name: 'Ana Pérez', title: 'Gerente de Personas', organization: { id: 'o1', name: 'Constructora Andes Sur', website_url: 'https://constructoraandessur.cl' } },
      { id: 'p2', name: 'Luis Soto', title: 'Jefe de Personas', organization: { id: 'o1', name: 'Constructora Andes Sur', website_url: 'https://constructoraandessur.cl' } },
      { id: 'p3', name: 'Eva Díaz', title: 'Gerente de Personas', organization: { id: 'o2', name: 'Retail Uno', industry: 'retail' } },
    ] }), classify) as any;
  assert.deepEqual(asked[0].companies, [{ key: 'id:o1', name: 'Constructora Andes Sur', domain: 'constructoraandessur.cl', location: null }],
    'each company once, and not the one Apollo gave a sector');
  const byName = Object.fromEntries(result.items.map((item: any) => [item.name, item]));
  assert.equal(byName['Ana Pérez'].industry, 'Construcción');
  assert.equal(byName['Ana Pérez'].industryEstimated, true);
  assert.match(byName['Ana Pérez'].fit, /Construcción/);
  assert.equal(byName['Eva Díaz'].industry, 'retail');
  assert.equal(byName['Eva Díaz'].industryEstimated, undefined);
});

test('«empresas primero» estimates the sector of the companies that have people, before ranking them', async () => {
  const { asked, classify } = estimated({ c1: 'Hotelería y alojamiento' });
  const request = async (payload: Record<string, unknown>) => payload.search_mode === 'organization_search'
    ? { organizations: [
      { id: 'c1', name: 'Hotel Bahía Azul', website_url: 'https://hotelbahiaazul.cl' },
      { id: 'c2', name: 'Hotel Sin Gente', website_url: 'https://hotelsingente.cl' },
    ] }
    : { leads: [{ id: 'p1', name: 'Rosa Vidal', title: 'Gerente General', organization: { id: 'c1', name: 'Hotel Bahía Azul' } }] };
  const result = await runCoworkSearch({ strategy: 'companies_first', titles: ['Gerente General'], industries: ['Hotelería'], locations: ['Chile'], limit: 25 },
    'user-1', request, classify) as any;
  assert.deepEqual(asked[0].companies.map(company => company.key), ['c1'], 'a company without people is not asked about');
  assert.equal(result.items[0].industry, 'Hotelería y alojamiento');
  assert.equal(result.items[0].industryEstimated, true);
  assert.match(result.items[0].fit, /Hotelería y alojamiento/);
});

test('without the classifier, or if it fails, the search goes as before', async () => {
  const organizations = { organizations: [{ id: 'org3', name: 'Vigilancia Andina', primary_domain: 'vigilanciaandina.pe' }] };
  const off = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Seguridad'], locations: [], limit: 25 }, 'user-1', async () => organizations, null) as any;
  assert.equal(off.items[0].industry, null);
  const failing = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Seguridad'], locations: [], limit: 25 }, 'user-1', async () => organizations,
    async () => { throw new Error('down'); }) as any;
  assert.equal(failing.items[0].industry, null);
});

// «Búscame 250 empresas» / «todas las que calcen»: the pages of the provider, 100 each, until there are no more.
const pageOf = (page: number, count: number, total: number, perPage = 100) => ({ organizations: Array.from({ length: count }, (_, index) => ({
  id: `p${page}-${index}`, name: `Empresa ${page}-${index}`, naics_codes: ['236220'] })), total_entries: total, total_pages: Math.ceil(total / perPage) });

test('a company search for more than 100 asks for the pages one by one and says how many match in all', async () => {
  const asked: Array<Record<string, unknown>> = [];
  const result = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Construcción'], locations: [], companyLocations: ['Chile'], limit: 250 },
    'user-1', async payload => { asked.push(payload); return pageOf(Number(payload.page), 100, 1240); }, null) as any;
  assert.deepEqual(asked.map(payload => [payload.page, payload.per_page]), [[1, 100], [2, 100], [3, 100]], 'a number between hundreds brings the whole last page');
  assert.equal(result.returned, 300);
  assert.equal(result.items.length, 300);
  assert.equal(result.total, 1240);
  assert.equal(result.pages, 3);
  assert.deepEqual(result.next, { page: 4 }, '«Traer más» continues from the next page');
  assert.equal(result.items[0].industry, 'Construcción');
});

test('«todas las que calcen» stops at the last page, and a later page that fails leaves the list incomplete but usable', async () => {
  const all = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Construcción'], locations: [], limit: 1000 },
    'user-1', async payload => pageOf(Number(payload.page), Number(payload.page) === 3 ? 40 : 100, 240), null) as any;
  assert.equal(all.returned, 240);
  assert.equal(all.next, null);
  assert.equal(all.hasMore, false);

  const partial = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Construcción'], locations: [], limit: 500 },
    'user-1', async payload => { if (Number(payload.page) === 2) throw new Error('timeout'); return pageOf(Number(payload.page), 100, 900); }, null) as any;
  assert.equal(partial.returned, 100);
  assert.deepEqual(partial.next, { page: 2 }, 'the page that failed is the next one to bring');
  assert.match(partial.notice, /Una parte de las páginas no respondió/);

  await assert.rejects(runCoworkSearch({ target: 'companies', titles: [], industries: ['Construcción'], locations: [], limit: 500 },
    'user-1', async () => { throw new Error('down'); }, null), /down/, 'the first page failing is the search failing');
});

test('a company search of up to 100 is one page, as before', async () => {
  const asked: number[] = [];
  const result = await runCoworkSearch({ target: 'companies', titles: [], industries: ['Construcción'], locations: [], limit: 25 },
    'user-1', async payload => { asked.push(Number(payload.per_page)); return pageOf(1, 25, 80, 25); }, null) as any;
  assert.deepEqual(asked, [25]);
  assert.equal(result.returned, 25);
  assert.deepEqual(result.next, { page: 2 });
});

// A staffing company that searches «Gerente de Personas» finds the HR managers of its competitors and its own (fictional companies).
test('a search leaves out the seller’s own company and its competitors, and says how many and which', async () => {
  const result = {
    scope: 'external_search', returned: 4, items: [
      { id: 'apollo:p1', name: 'Ana', title: 'Gerente de Personas', company: 'Retail Andino', company_website: 'https://retailandino.cl', industry: 'retail' },
      { id: 'apollo:p2', name: 'Beto', title: 'Gerente de Personas', company: 'Talento Austral Outsourcing', company_website: null, industry: null },
      { id: 'apollo:p3', name: 'Carla', title: 'Jefa de Selección', company: 'Talento Austral Outsourcing', company_website: null, industry: null },
      { id: 'apollo:p4', name: 'Dani', title: 'Gerente de Personas', company: 'Otra razón', company_website: 'https://www.personalboreal.cl', industry: 'human resources' },
    ],
  };
  const seller = { organizationId: 'org', names: ['PersonalBoreal'], domains: ['personalboreal.com'], sector: 'Outsourcing', description: 'Personal transitorio', services: 'EST' };
  const asked: Array<{ key: string; name: string | null; domain?: string | null }> = [];
  const filtered = await withoutOwnCompanyAndCompetitors({} as never, { userId: 'u', organizationId: 'org' }, result, {
    seller: async () => seller,
    relate: async (sellerSeen, companies) => {
      asked.push(...companies);
      const relations = await companyRelator({})(sellerSeen, companies);
      for (const company of companies) if (company.name === 'Talento Austral Outsourcing') relations.set(company.key, { relation: 'competencia', reason: 'Outsourcing', via: 'ia' });
      return relations;
    },
  });
  assert.deepEqual(asked.map(company => [company.key, company.name, company.domain]), [
    ['apollo:p1', 'Retail Andino', 'https://retailandino.cl'], ['apollo:p2', 'Talento Austral Outsourcing', null],
    ['apollo:p3', 'Talento Austral Outsourcing', null], ['apollo:p4', 'Otra razón', 'https://www.personalboreal.cl'],
  ]);
  assert.deepEqual(filtered.items.map(item => item.id), ['apollo:p1']);
  assert.equal(filtered.returned, 1);
  assert.deepEqual(filtered.omitted, { ownCompany: 1, competitors: 2, companies: ['Talento Austral Outsourcing'] });
  assert.equal(filtered.omittedNote, 'Dejé fuera 2 personas de la competencia (Talento Austral Outsourcing) y 1 de tu propia empresa: no son clientes para lo que vendes.');
  // Nothing to leave out, no seller or a failure: the result goes as it came.
  const same = await withoutOwnCompanyAndCompetitors({} as never, { userId: 'u', organizationId: 'org' }, result, { seller: async () => null });
  assert.equal(same, result);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failed = await withoutOwnCompanyAndCompetitors({} as never, { userId: 'u', organizationId: 'org' }, result, { seller: async () => seller, relate: async () => { throw new Error('down'); } });
    assert.equal(failed, result);
  } finally {
    console.warn = warn;
  }
});

test('the note of what a search left out reads well for people and for companies', () => {
  assert.equal(omittedSearchNote({ ownCompany: 0, competitors: 0, companies: [] }, false), '');
  assert.equal(omittedSearchNote({ ownCompany: 3, competitors: 0, companies: [] }, false), 'Dejé fuera 3 personas de tu propia empresa: no son clientes para lo que vendes.');
  assert.equal(omittedSearchNote({ ownCompany: 0, competitors: 1, companies: ['Talento Austral'] }, true), 'Dejé fuera 1 empresa de la competencia (Talento Austral): no son clientes para lo que vendes.');
});
