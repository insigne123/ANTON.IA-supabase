import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseWebEvidenceV2, resolveEntityFromExistingContextV2 } from '@/lib/report-v2-extraction';
import {
  REQUIRED_REPORT_V2_QUERY_FAMILIES,
  normalizeResearchPlanV2,
  planReportV2Research,
} from './plan-report-v2-research';

const golden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const provider = JSON.parse(readFileSync('test/fixtures/grupoexpro/provider-context.json', 'utf8'));

function entity() {
  return resolveEntityFromExistingContextV2({
    contact: provider.contact,
    domain: golden.domain,
    sources: [parseWebEvidenceV2({
      html: readFileSync('test/fixtures/grupoexpro/peru.html', 'utf8'),
      url: 'https://grupoexpro.com/peru/quienes-somos/',
      targetDomain: golden.domain,
      retrievedAt: golden.capturedAt,
      jurisdiction: 'PE',
    })],
  });
}

test('normalizes a partial plan to all seven mandatory families with at most two own-domain queries', () => {
  const plan = normalizeResearchPlanV2({
    queries: Array.from({ length: 4 }, (_, index) => ({
      family: index % 2 ? 'press' : 'scale',
      query: `"GrupoExpro" query ${index}`,
      targetField: `field.${index}`,
      ownDomain: true,
      recencyDays: index % 2 ? 365 : null,
    })),
  }, { entity: entity(), targetTitles: ['Director Corporativo de Negocios'], industry: 'servicios transitorios', currentYear: 2026 });
  const families = new Set(plan.queries.map((query) => query.family));
  REQUIRED_REPORT_V2_QUERY_FAMILIES.forEach((family) => assert.ok(families.has(family), `Missing ${family}`));
  assert.ok(plan.queries.length >= 7 && plan.queries.length <= 12);
  assert.ok(plan.queries.filter((query) => query.ownDomain).length <= 2);
  assert.ok(plan.queries.find((query) => query.family === 'people')?.query.includes('Director Corporativo de Negocios'));
});

test('uses the deterministic emergency plan when OpenAI planning fails', async () => {
  const plan = await planReportV2Research({
    entity: entity(),
    sellerProfile: golden.sellerProfile,
    existingClaimsSummary: [],
    targetTitles: ['Director Corporativo de Negocios'],
    industry: 'servicios transitorios',
    currentYear: 2026,
  }, { generate: async () => { throw new Error('provider unavailable'); } });
  assert.deepEqual(new Set(plan.queries.map((query) => query.family)), new Set(REQUIRED_REPORT_V2_QUERY_FAMILIES));
  assert.ok(plan.queries.find((query) => query.family === 'press')?.query.includes('2026'));
});
