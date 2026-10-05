import assert from 'node:assert/strict';
import test from 'node:test';
import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { LEADS_FINDER_ENUMS } from './actor-enums';
import { LeadsFinderError, maskLastName, searchLeadsFinder, splitLeadsFinderItems } from './client';
import { leadsFinderInput, sizeBrackets } from './input';

const search = (patch: Partial<LeadSearchInput> = {}): LeadSearchInput => ({
  provider: 'apollo', searchMode: 'batch', revealEmail: false, revealPhone: false, organizationDomains: [], titles: [], seniorities: [],
  industryKeywords: [], companyKeywords: [], companyLocations: [], personLocations: [], employeeRanges: [], includeSimilarTitles: true,
  maxResults: 25, ...patch,
});

/** A row as the actor returns it (its published output fields). */
const ITEM = {
  first_name: 'Ana', last_name: 'Pérez', full_name: 'Ana Pérez', job_title: 'Gerente de Personas', headline: 'Gerente de Personas en Retail Andino',
  functional_level: 'human_resources', seniority_level: 'manager', email: 'Ana.Perez@retailandino.cl', email_status: 'validated',
  mobile_number: '+56 9 1234 5678', personal_email: 'ana@gmail.com', linkedin: 'linkedin.com/in/ana-perez-1', city: 'Santiago', state: 'Santiago Metropolitan',
  country: 'Chile', company_name: 'Retail Andino', company_domain: 'retailandino.cl', company_website: 'https://www.retailandino.cl',
  company_linkedin: 'https://www.linkedin.com/company/retail-andino', company_size: '1001-2000', industry: 'retail',
  company_description: 'Cadena de tiendas en Chile.',
};

test('the filters of «Buscar prospectos» become the actor input, with only values the actor accepts', () => {
  const mapped = leadsFinderInput(search({
    titles: ['Gerente de Personas', 'Jefe de Reclutamiento', 'Gerente de Personas'], seniorities: ['manager', 'intern', 'jefazo'],
    personLocations: ['Santiago, Chile', 'Región Metropolitana', 'Valparaíso', 'Perú', 'Región de la Araucanía'],
    employeeRanges: ['51,200', '1000,10000000'], industryKeywords: ['Recursos Humanos', 'retail', 'aseo industrial'], companyKeywords: ['outsourcing'],
    organizationDomains: ['retailandino.cl'], maxResults: 500,
  }));
  assert.ok(mapped.ok);
  const input = mapped.input;
  assert.deepEqual(input.contact_job_title, ['Gerente de Personas', 'Jefe de Reclutamiento']);
  assert.deepEqual(input.seniority_level, ['manager', 'trainee']);
  assert.ok(mapped.notApplied.some(note => note.includes('jefazo')), 'an unknown seniority is reported, not sent');
  assert.deepEqual(input.contact_location?.sort(), ['chile', 'peru', 'santiago metropolitan region, chile', 'valparaiso region, chile'].sort());
  assert.deepEqual(input.contact_city?.sort(), ['santiago', 'temuco'].sort(), 'a city as text; a region the actor lacks, as its capital');
  assert.deepEqual(input.size, ['51-100', '101-200', '501-1000', '1001-2000', '2001-5000', '5001-10000', '10001-20000', '20001-50000', '50000+']);
  assert.deepEqual(input.company_industry, ['human resources', 'retail']);
  assert.deepEqual(input.company_keywords?.sort(), ['aseo industrial', 'outsourcing'].sort(), 'an industry outside the list searches as a keyword');
  assert.deepEqual(input.company_domain, ['retailandino.cl']);
  assert.deepEqual(input.email_status, ['validated']);
  assert.equal(input.fetch_count, 100, 'one page at most');

  const accepted = (field: keyof typeof LEADS_FINDER_ENUMS, values: string[] | undefined) =>
    (values || []).every(value => (LEADS_FINDER_ENUMS[field] as readonly string[]).includes(value));
  assert.ok(accepted('seniority_level', input.seniority_level));
  assert.ok(accepted('size', input.size));
  assert.ok(accepted('company_industry', input.company_industry));
  assert.ok(accepted('contact_location_sample', input.contact_location));
  assert.ok(accepted('email_status', input.email_status));
});

test('a company location is used as the person\'s, and says so; a search without any filter is refused before calling Apify', () => {
  const mapped = leadsFinderInput(search({ titles: ['Gerente'], companyLocations: ['Chile'] }));
  assert.ok(mapped.ok);
  assert.deepEqual(mapped.input.contact_location, ['chile']);
  assert.match(mapped.notApplied.join(' '), /ubicación de la empresa/);
  const empty = leadsFinderInput(search({ personLocations: ['Chile'] }));
  assert.equal(empty.ok, false);
  const byName = leadsFinderInput(search({ searchMode: 'company_name', companyName: 'Retail Andino', titles: ['Gerente'] }));
  assert.equal(byName.ok, false, 'a search by company name needs its website');
  const byDomain = leadsFinderInput(search({ searchMode: 'company_name', companyName: 'Retail Andino', selectedOrganizationDomain: 'retailandino.cl' }));
  assert.ok(byDomain.ok);
  assert.deepEqual(byDomain.input.company_domain, ['retailandino.cl']);
});

test('employee ranges map to every bracket they overlap', () => {
  assert.deepEqual(sizeBrackets('1,10'), ['1-10']);
  assert.deepEqual(sizeBrackets('0,25'), ['1-10', '11-20', '21-50']);
  assert.deepEqual(sizeBrackets('60000,10000000'), ['50000+']);
  assert.deepEqual(sizeBrackets('x'), []);
});

test('a result looks like Apollo\'s, with the last name masked and no way to reach the person before enriching', () => {
  assert.equal(maskLastName('Pérez'), 'Pé***z');
  assert.equal(maskLastName('Li'), 'L***');
  const [first, ...rest] = splitLeadsFinderItems([ITEM, { ...ITEM }, { job_title: 'sin nombre', email: 'x@y.cl' }, 'basura']);
  assert.equal(rest.length, 0, 'the same person twice and an item without a name are dropped');
  const { lead, contact } = first;
  assert.equal(lead.name, 'Ana Pé***z');
  assert.equal(lead.has_email, true);
  assert.equal(lead.has_direct_phone, true);
  assert.equal(lead.source_provider, 'leads_finder');
  assert.match(lead.id, /^lf_[0-9a-f]{24}$/);
  assert.equal(lead.organization_domain, 'retailandino.cl');
  assert.equal(lead.organization.linkedin_url, 'https://www.linkedin.com/company/retail-andino', 'the company page is public data');
  const shown = JSON.stringify(lead);
  for (const secret of ['ana.perez@retailandino.cl', 'Ana.Perez', '1234 5678', 'gmail', 'ana-perez-1', 'Pérez']) {
    assert.equal(shown.toLowerCase().includes(secret.toLowerCase()), false, `the public lead must not carry «${secret}»`);
  }
  assert.deepEqual(contact, {
    fullName: 'Ana Pérez', firstName: 'Ana', lastName: 'Pérez', email: 'ana.perez@retailandino.cl', personalEmail: 'ana@gmail.com',
    mobileNumber: '+56 9 1234 5678', linkedinUrl: 'https://linkedin.com/in/ana-perez-1', emailStatus: 'validated',
  });
  assert.equal(splitLeadsFinderItems([ITEM])[0].lead.id, lead.id, 'the same person keeps the same id');
});

test('the run goes to the actor with the token in a header, capped in items, time and money, and estimates its cost', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await searchLeadsFinder(search({ titles: ['Gerente de Personas'], personLocations: ['Chile'], maxResults: 25 }), {
    token: 'tok', usdPerLead: 0.002, maxRunUsd: 0.5,
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify([ITEM, { ...ITEM, first_name: 'Luis', full_name: 'Luis Soto', email: 'luis@x.cl', linkedin: 'linkedin.com/in/luis' }]), { status: 201 }); }) as typeof fetch,
  });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v2/acts/code_crafter~leads-finder/run-sync-get-dataset-items');
  assert.equal(url.searchParams.get('maxItems'), '25');
  assert.equal(url.searchParams.get('maxTotalChargeUsd'), '0.5');
  assert.equal(url.searchParams.get('timeout'), '110');
  assert.equal(url.search.includes('tok'), false, 'the token never travels in the URL');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer tok');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.fetch_count, 25);
  assert.deepEqual(body.contact_location, ['chile']);
  assert.equal(result.results.length, 2);
  assert.equal(result.fetched, 2);
  assert.equal(result.costUsd, 0.004);
});

test('Apify errors say whether the run may have charged, without Apify\'s own text', async () => {
  const run = (status: number, body: unknown) => searchLeadsFinder(search({ titles: ['Gerente'] }), {
    token: 'tok', fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
  });
  const cases: Array<[number, unknown, boolean, RegExp]> = [
    [401, { error: { type: 'user-or-token-not-found' } }, false, /token/],
    [402, {}, false, /saldo/],
    [400, { error: { type: 'invalid-input', message: 'secreto de apify' } }, false, /no se cobró/],
    [400, { error: { type: 'run-failed' } }, true, /falló \(run-failed\)/],
    [408, { error: { type: 'run-timeout-exceeded' } }, true, /tardó demasiado/],
  ];
  for (const [status, body, charged, message] of cases) {
    await assert.rejects(run(status, body), (error: unknown) => {
      assert.ok(error instanceof LeadsFinderError);
      assert.equal(error.mayHaveCharged, charged, `${status} charged?`);
      assert.match(error.message, message);
      assert.equal(error.message.includes('secreto'), false);
      return true;
    });
  }
  await assert.rejects(run(201, { not: 'a list' }), /no entregó una lista/);
  await assert.rejects(searchLeadsFinder(search({ titles: ['x'] }), { token: undefined, fetch: globalThis.fetch }), /APIFY_TOKEN/);
});
