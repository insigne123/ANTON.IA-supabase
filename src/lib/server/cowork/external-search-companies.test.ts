import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_SEARCH_NOTICE, normalizeCoworkSearchResult, runCoworkSearch } from './external-search';

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
