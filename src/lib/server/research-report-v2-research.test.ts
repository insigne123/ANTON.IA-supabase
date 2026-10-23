import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { gatherReportV2Research, fetchReportV2Source } from './research-report-v2-research';

const entity = {
  companyName: 'Acme', companyDomain: 'acme.example', contactCountry: 'PE', operatingCountries: [], countryScopedPaths: {}, excludedPaths: [], ambiguities: [],
  contact: { fullName: 'Ada', title: 'Director', seniority: 'director', department: 'Operations', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null },
};
const projection = { entity, qualification: { verdict: 'qualified', allowedDepth: 'shallow', reasons: [], redirectTo: [] }, sources: [], facts: [], claims: [], shortIdMap: {}, committee: [], initialGaps: [] } as any;
const queries = Array.from({ length: 6 }, (_, index) => ({ query: `Acme topic ${index}`, family: 'operations', ownDomain: false, targetField: 'company', recencyDays: null }));

test('real research stage limits requests, extracts fetched sources, and isolates failed sites', async () => {
  let requests = 0;
  let active = 0;
  let peak = 0;
  let extractionCalls = 0;
  const result = await gatherReportV2Research({ projection, sellerProfile: { products: [] }, organizationId: 'org', language: 'es' }, {
    plan: async () => ({ queries }) as any,
    resolve: async () => entity as any,
    search: async (request) => ({ items: Array.from({ length: 4 }, (_, index) => ({ link: `https://source.example/${request.query}/${index}` })) }) as any,
    fetchSource: async ({ url }) => {
      requests += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (url.includes('topic 1')) throw new Error('blocked site');
      return parseWebEvidenceV2({ html: '<article><p>Acme presta servicios de coordinacion y soporte para equipos de operaciones de sus clientes.</p></article>', url, targetDomain: 'acme.example', retrievedAt: '2026-09-08T00:00:00.000Z' });
    },
    extract: async ({ sources }) => {
      extractionCalls += 1;
      assert.ok(sources.length <= 3);
      return { sources: sources.map((source) => source.source), facts: [], claimDrafts: [], results: [], failedSourceIds: [] };
    },
  });
  assert.ok(requests <= 18);
  assert.ok(peak <= 3);
  assert.ok(result.researchMetrics.pages <= 18);
  assert.equal(result.researchMetrics.queries, 6);
  assert.ok(extractionCalls > 0);
  assert.deepEqual(result.claims, []);
});

test('public page fetch rejects credentialed, local and private addresses before HTTP', async () => {
  for (const url of ['http://127.0.0.1/', 'http://localhost/', 'https://user:pass@example.com', 'http://[::1]/']) {
    await assert.rejects(fetchReportV2Source({ url, domain: 'example.com' }), /UNSAFE/);
  }
});

test('claims are extracted three sources at a time, up to three extractions at once, in the order of the sources', async () => {
  let active = 0;
  let peak = 0;
  let searchesActive = 0;
  let searchesPeak = 0;
  const seen: string[][] = [];
  const result = await gatherReportV2Research({ projection, sellerProfile: { products: [] }, organizationId: 'org', language: 'es', depth: 'standard' }, {
    plan: async () => ({ queries }) as any,
    resolve: async () => entity as any,
    search: async (request) => {
      searchesActive += 1;
      searchesPeak = Math.max(searchesPeak, searchesActive);
      await new Promise((resolve) => setTimeout(resolve, 5));
      searchesActive -= 1;
      return { items: Array.from({ length: 4 }, (_, index) => ({ link: `https://source.example/${request.query}/${index}` })) } as any;
    },
    fetchSource: async ({ url }) => parseWebEvidenceV2({ html: '<article><p>Acme presta servicios de coordinacion y soporte para equipos de operaciones de sus clientes.</p></article>', url, targetDomain: 'acme.example', retrievedAt: '2026-09-08T00:00:00.000Z' }),
    extract: async ({ sources }) => {
      active += 1;
      peak = Math.max(peak, active);
      seen.push(sources.map((source) => source.source.url));
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { sources: sources.map((source) => source.source), facts: [], claimDrafts: [], results: [], failedSourceIds: [] };
    },
  });
  assert.ok(result.researchMetrics.pages > 6, 'enough pages for several extractions');
  assert.ok(peak > 1 && peak <= 3, `extractions overlap, at most three (peak ${peak})`);
  assert.ok(searchesPeak > 3 && searchesPeak <= 5, `searches overlap, at most five (peak ${searchesPeak})`);
  assert.ok(seen.every((urls) => urls.length <= 3));
  assert.equal(seen.flat().length, result.researchMetrics.pages, 'every fetched source is read once');
});

const researcher = { model: 'claude-sonnet-5-5', effort: 'low' as const, searches: 6, fetches: 3, maxSources: 8, deadlineMs: 30_000 };
const page = (url: string) => parseWebEvidenceV2({ html: '<article><p>Acme presta servicios de coordinacion y soporte para equipos de operaciones de sus clientes.</p></article>', url, targetDomain: 'acme.example', retrievedAt: '2026-09-08T00:00:00.000Z' });
const withResearcher = (order: string[], seen: unknown[] = []) => ({
  plan: async () => ({ queries: queries.slice(0, 2) }) as any,
  resolve: async () => entity as any,
  search: async (request: { query: string }) => ({ items: [{ link: `https://source.example/${request.query}/0` }] }) as any,
  fetchSource: async ({ url }: { url: string }) => { order.push(url); return page(url); },
  extract: async ({ sources }: { sources: Array<{ source: unknown }> }) => ({ sources: sources.map((source) => source.source), facts: [], claimDrafts: [], results: [], failedSourceIds: [] }) as any,
  claudeWeb: researcher,
  discover: async (request: unknown) => {
    seen.push(request);
    return { sources: ['https://prensa.example/noticia-1', 'https://prensa.example/noticia-2'].map((url) => ({ url, title: 'Nota', why: 'Un hecho', date: '2026-10-17' })),
      coverage: null, searches: 3, reads: 1, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'claude-sonnet-5-5', stopReason: 'final_tool' };
  },
}) as any;

test('with the researcher on, the pages it picked are read before the ones the search engine ranks, and it is told the company and the role, never the person', async () => {
  const order: string[] = [];
  const seen: any[] = [];
  const result = await gatherReportV2Research({ projection, sellerProfile: { products: [{ key: 'p', name: 'AXIS', description: 'revisa antecedentes de postulantes' }] }, organizationId: 'org', language: 'es' }, withResearcher(order, seen));
  const picked = order.findIndex((url) => url.includes('prensa.example'));
  const ranked = order.findIndex((url) => url.includes('source.example'));
  assert.ok(picked > 0 && ranked > picked, `picked pages first (${order.join(', ')})`);
  assert.deepEqual(result.researchMetrics.claudeWeb, { sources: 2, searches: 3, reads: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].companyName, 'Acme');
  assert.equal(seen[0].contactTitle, 'Director');
  assert.equal(seen[0].sellerOffer, 'AXIS: revisa antecedentes de postulantes');
  assert.equal(JSON.stringify(seen[0]).includes('Ada'), false, 'the name of the person does not leave');
});

test('a researcher that fails costs only the pages it would have found, and one that is off is not called', async () => {
  const order: string[] = [];
  const failing = await gatherReportV2Research({ projection, sellerProfile: { products: [] }, organizationId: 'org', language: 'es' },
    { ...withResearcher(order), discover: async () => { throw new Error('anthropic down'); } });
  assert.ok(failing.researchWarnings.includes('claude_web_unavailable'));
  assert.ok(failing.researchMetrics.pages > 0, 'the search engine still fed the research');
  assert.equal('claudeWeb' in failing.researchMetrics, false);
  let called = 0;
  await gatherReportV2Research({ projection, sellerProfile: { products: [] }, organizationId: 'org', language: 'es' },
    { ...withResearcher([]), claudeWeb: null, discover: async () => { called += 1; return null as any; } });
  assert.equal(called, 0);
});
