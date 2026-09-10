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
