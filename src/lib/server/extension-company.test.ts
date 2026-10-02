import test from 'node:test';
import assert from 'node:assert/strict';
import { readExtensionCompany } from './extension-company';

const NOW = Date.parse('2026-10-02T15:00:00Z');
type Row = Record<string, unknown>;
type Call = { table: string; filters: unknown[] };
// Any chain of filters ends in the rows of its table: the reader filters what it gets, so the fake does not have to.
function fakeClient(tables: Record<string, Row[]>, calls: Call[]) {
  return {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const result = () => ({ data: tables[table] || [], error: null });
      const query: any = {
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
        maybeSingle: async () => ({ data: (tables[table] || [])[0] ?? null, error: null }),
      };
      for (const method of ['select', 'eq', 'neq', 'or', 'in', 'gte', 'lte', 'order', 'limit', 'ilike', 'contains']) {
        query[method] = (...args: unknown[]) => { call.filters.push([method, ...args]); return query; };
      }
      return query;
    },
  };
}

const company = { linkedinUrl: 'https://www.linkedin.com/company/minera-norte', name: 'Minera Norte S.A.', domain: 'mineranorte.cl',
  industry: 'Minería', size: '1.001-5.000 empleados', headquarters: 'Antofagasta' };
const tables = {
  enriched_leads: [
    { id: 'e1', full_name: 'Ana Rojas', title: 'Jefa de Operaciones', company_name: 'MINERA NORTE', email: 'ana@mineranorte.cl', linkedin_url: 'https://www.linkedin.com/in/ana-rojas/', organization_domain: null },
    { id: 'e2', full_name: 'Pedro Díaz', title: 'Gerente General', company_name: 'Minera Norte Servicios', email: null, linkedin_url: 'https://www.linkedin.com/in/pedro-diaz', organization_domain: 'www.mineranorte.cl' },
    // A name inside another is another company.
    { id: 'e3', full_name: 'Otra Persona', title: 'Gerente', company_name: 'Minera Norte Grande', email: 'x@mng.cl', linkedin_url: null, organization_domain: 'mng.cl' },
  ],
  leads: [
    // The same person saved twice is one contact; a lead found by the company page counts.
    { id: 'l1', name: 'Ana Rojas', title: 'Jefa de Operaciones', company: 'Minera Norte', email: 'ana@mineranorte.cl', linkedin_url: 'https://linkedin.com/in/ana-rojas', company_website: null, company_linkedin: null },
    { id: 'l2', name: 'Luis Soto', title: 'Subgerente de Abastecimiento', company: 'MN', email: null, linkedin_url: null, company_website: null, company_linkedin: 'linkedin.com/company/minera-norte/' },
  ],
  profiles: [{ company_name: 'Mi empresa', signatures: { profile_extended: { targetRoles: ['Gerente de Operaciones', 'Jefe de Abastecimiento'] } } }],
  commercial_opportunity_profiles: [{ id: 'p1', name: 'GrupoExpro', offer: '', roles: [], regions: [], min_ads: 3, keywords: [], unspsc_codes: [], seia_sectors: [], min_investment_usd: null, sources: ['hiring'], updated_at: '2026-10-01T00:00:00Z' }],
  commercial_opportunities: [
    { id: 'o2', title: 'Banco Norte', company_name: 'Banco Norte', company_domain: 'banconorte.cl', company_linkedin_url: null, region: null, url: null, score: 90, reasons: [], status: 'new', claimed_by: null, signal_count: 9, published_at: '2026-09-30T00:00:00Z', first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-10-01T00:00:00Z', data: { roles: [], publishers: [], sources: ['jsearch'], lastPostedAt: '2026-09-30T00:00:00Z', windowDays: 30 } },
    { id: 'o1', title: 'Minera Norte', company_name: 'Minera Norte', company_domain: 'mineranorte.cl', company_linkedin_url: null, region: 'Antofagasta', url: null, score: 72, reasons: [], status: 'new', claimed_by: null, signal_count: 6, published_at: '2026-09-28T00:00:00Z', first_seen_at: '2026-09-10T00:00:00Z', last_seen_at: '2026-10-01T00:00:00Z', data: { roles: [{ role: 'operador de camión', ads: 4 }, { role: 'mantenedor', ads: 2 }], publishers: ['LinkedIn'], sources: ['linkedin'], lastPostedAt: '2026-09-28T00:00:00Z', windowDays: 30 } },
  ],
};
const auth = (client: unknown, email = 'piloto@grupoexpro.cl') => ({ supabase: client as any, organizationId: 'org-1',
  user: { id: 'me', email, email_confirmed_at: '2026-01-01T00:00:00Z' } as any });

test('the company: its saved contacts once each, with what the organization knows, and the search for its decision makers', async () => {
  const calls: Call[] = [];
  const client = fakeClient(tables, calls);
  const presenceCalls: unknown[] = [];
  const view = await readExtensionCompany(auth(client, 'otra@example.test'), company, {
    presence: (async (_auth: unknown, urls: string[]) => { presenceCalls.push(urls); return { 'https://www.linkedin.com/in/ana-rojas': { label: 'Respondió hace 2 días', tone: 'success', blocks: false } }; }) as any,
    admin: () => client as any, allowedEmails: 'piloto@grupoexpro.cl', now: () => NOW,
  });
  assert.deepEqual(view.contacts.map(contact => [contact.name, contact.presence?.label ?? null, contact.hasEmail]), [
    ['Ana Rojas', 'Respondió hace 2 días', true], ['Luis Soto', null, false], ['Pedro Díaz', null, false],
  ]);
  assert.equal(view.total, 3);
  assert.equal(view.truncated, false);
  assert.deepEqual(presenceCalls, [['https://www.linkedin.com/in/ana-rojas', 'https://www.linkedin.com/in/pedro-diaz']]);
  assert.equal(view.searchHref, '/search?company=Minera+Norte+S.A.&domain=mineranorte.cl&titles=Gerente+de+Operaciones%2C+Jefe+de+Abastecimiento');
  assert.equal(view.opportunity, null, 'Not an account of the pilot list: no opportunity, and the opportunities are not read');
  assert.ok(!calls.some(call => call.table.startsWith('commercial_')));
  // Every read is the active organization's, and the name is searched without its legal suffix.
  for (const call of calls.filter(item => ['enriched_leads', 'leads'].includes(item.table))) {
    assert.deepEqual(call.filters.find(filter => (filter as unknown[])[0] === 'eq'), ['eq', 'organization_id', 'org-1']);
    assert.match(String((call.filters.find(filter => (filter as unknown[])[0] === 'or') as unknown[])[1]), /ilike\."%Minera Norte%"/);
  }
});

test('the pilot account also sees the company hiring, with its signal; another company with the same word is not it', async () => {
  const calls: Call[] = [];
  const client = fakeClient(tables, calls);
  const view = await readExtensionCompany(auth(client), company, {
    presence: (async () => ({})) as any, admin: () => client as any, allowedEmails: 'piloto@grupoexpro.cl', now: () => NOW,
  });
  assert.equal(view.opportunity?.company, 'Minera Norte');
  assert.equal(view.opportunity?.ads, 6);
  assert.equal(view.opportunity?.page, '/opportunities');
  assert.match(view.opportunity?.signal || '', /^Minera Norte publicó 6 avisos de empleo en los últimos 30 días \(4 de operador de camión y 2 de mantenedor\)/);
});

test('without a name, domain or page to look for, nothing is read but the profile', async () => {
  const calls: Call[] = [];
  const client = fakeClient(tables, calls);
  const view = await readExtensionCompany(auth(client, 'otra@example.test'), { ...company, name: '%', domain: '', linkedinUrl: 'https://www.linkedin.com/company/' + '_' },
    { presence: (async () => ({})) as any, admin: () => client as any, allowedEmails: '', now: () => NOW });
  assert.deepEqual(view.contacts, []);
  assert.deepEqual(calls.map(call => call.table), ['profiles']);
});
