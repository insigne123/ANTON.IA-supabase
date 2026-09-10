import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { generateStructured } from '@/ai/openai-json';
import type { EntityResolutionV2 } from '@/lib/report-v2-contracts';
import { parseWebEvidenceV2, resolveEntityFromExistingContextV2 } from '@/lib/report-v2-extraction';
import {
  REQUIRED_REPORT_V2_QUERY_FAMILIES,
  ResearchPlanV2Schema,
  buildPlanReportV2Prompt,
  normalizeResearchPlanV2,
  planReportV2Research,
  type ResearchQueryV2,
} from './plan-report-v2-research';

const entity: EntityResolutionV2 = {
  companyName: 'Acme',
  companyDomain: 'acme.example',
  contactCountry: 'PE',
  operatingCountries: ['PE', 'CL'],
  countryScopedPaths: { PE: '/peru/', CL: '/chile/' },
  excludedPaths: ['/chile/'],
  contact: {
    fullName: 'Renata Perez', title: 'Directora de Finanzas', department: 'Finanzas', seniority: 'director',
    tenureMonths: null, companyTenureMonths: null, linkedinUrl: null,
  },
  ambiguities: [],
};
const input = {
  entity,
  sellerProfile: { product: 'Automatizacion de conciliacion financiera' },
  existingClaimsSummary: [{ field: 'services', statement: 'Acme presta servicios de seleccion de personal.' }],
  targetTitles: ['Gerente de Administracion y Finanzas'],
  industry: 'servicios de personal',
  currentYear: 2026,
};
const focusedQueries: ResearchQueryV2[] = [
  { family: 'scale', query: 'site:acme.example "Acme" colaboradores', targetField: 'snapshot.company_scale', ownDomain: true, recencyDays: null },
  { family: 'operations', query: 'site:acme.example/peru/ "Acme" operaciones', targetField: 'company.local_operations', ownDomain: true, recencyDays: null },
  { family: 'press', query: '"Acme" Peru noticias 2026', targetField: 'signals.recent_press', ownDomain: false, recencyDays: 365 },
  { family: 'people', query: '"Acme" "Gerente de Administracion y Finanzas" Peru', targetField: 'committee.target_roles', ownDomain: false, recencyDays: null },
];

const grupoexproGolden = JSON.parse(readFileSync('test/fixtures/grupoexpro.golden.json', 'utf8'));
const grupoexproProvider = JSON.parse(readFileSync('test/fixtures/grupoexpro/provider-context.json', 'utf8'));

function grupoexproEntity() {
  return resolveEntityFromExistingContextV2({
    contact: grupoexproProvider.contact,
    domain: grupoexproGolden.domain,
    sources: [parseWebEvidenceV2({
      html: readFileSync('test/fixtures/grupoexpro/peru.html', 'utf8'),
      url: 'https://grupoexpro.com/peru/quienes-somos/',
      targetDomain: grupoexproGolden.domain,
      retrievedAt: grupoexproGolden.capturedAt,
      jurisdiction: 'PE',
    })],
  });
}

test('accepts a real four-query Luna plan without padding seven mandatory families', async () => {
  const calls: Parameters<typeof generateStructured>[0][] = [];
  const plan = await planReportV2Research(input, {
    generate: async (options) => {
      calls.push(options);
      return options.schema.parse({ queries: focusedQueries });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'openai');
  assert.equal(calls[0].allowDefaultModelFallback, false);
  assert.equal(calls[0].openAiModels?.[0], 'gpt-5.6-luna');
  assert.deepEqual(calls[0].openAiModels, ['gpt-5.6-luna']);
  assert.deepEqual(plan.queries, focusedQueries);
  assert.ok(plan.queries.every((query) => !['hiring', 'industry', 'registry'].includes(query.family)));
  assert.equal(plan.queries[0].recencyDays, null);
  assert.equal(plan.queries[2].recencyDays, 365);
});

test('the prompt uses the lead, known context and relevant roles without quotas or keyword pileups', () => {
  const prompt = buildPlanReportV2Prompt(input);
  assert.ok(prompt.includes('entre 4 y 6'));
  assert.ok(prompt.includes('Renata Perez'));
  assert.ok(prompt.includes(input.targetTitles[0]));
  assert.ok(prompt.includes(input.industry));
  assert.ok(prompt.includes('Acme presta servicios de seleccion de personal.'));
  assert.ok(prompt.includes('No repitas lo que ya esta respaldado'));
  assert.ok(prompt.includes('No hay cuota minima ni maxima'));
  assert.ok(prompt.includes('no apiles diez palabras clave'));
  assert.ok(!prompt.includes('familia obligatoria'));
});

test('keeps useful corporate queries beyond two and allows plans without site searches', () => {
  const corporate = normalizeResearchPlanV2({ queries: [
    focusedQueries[0], focusedQueries[1],
    { ...focusedQueries[0], query: 'site:acme.example "Acme" clientes', targetField: 'snapshot.client_count' },
    { ...focusedQueries[0], query: 'site:acme.example "Acme" sedes', targetField: 'company.headquarters' },
  ] }, input);
  assert.equal(corporate.queries.length, 4);
  assert.equal(corporate.queries.filter((query) => query.ownDomain).length, 4);

  const external = focusedQueries.map((query) => ({ ...query, query: query.query.replace(/site:\S+\s*/, ''), ownDomain: false }));
  assert.deepEqual(normalizeResearchPlanV2({ queries: external }, input).queries, external);
});

test('normalization removes duplicates across families and only fills a partial plan to four queries', () => {
  const plan = normalizeResearchPlanV2({ queries: [
    focusedQueries[0],
    { ...focusedQueries[0], family: 'industry', query: ' SITE:ACME.EXAMPLE   "ACME" colaboradores ' },
    null,
    { family: 'people' },
  ] }, input);
  assert.equal(plan.queries.length, 4);
  assert.equal(new Set(plan.queries.map((query) => query.query.toLowerCase())).size, 4);
  assert.ok(plan.queries.some((query) => query.targetField === 'committee.target_roles'));
});

test('bounds normal plans at six and discards overly conjunctive searches', () => {
  const plan = normalizeResearchPlanV2({ queries: [
    { ...focusedQueries[0], query: '"Acme" colaboradores AND clientes AND sedes AND contratos AND automatizacion AND Peru' },
    { ...focusedQueries[0], query: '"Acme" colaboradores clientes sedes contratos automatizacion Peru sector industria vacantes' },
    ...Array.from({ length: 9 }, (_, index) => ({ ...focusedQueries[0], query: `"Acme" tema${index}` })),
  ] }, input);
  assert.equal(plan.queries.length, 6);
  assert.ok(plan.queries.every((query) => query.query.startsWith('"Acme" tema')));
  assert.ok(ResearchPlanV2Schema.safeParse(plan).success);
});

test('uses a focused emergency plan for scale, local operations, press, relevant roles and the lead', async () => {
  const plan = await planReportV2Research(input, {
    generate: async () => { throw new Error('provider unavailable'); },
  });
  assert.equal(plan.queries.length, 5);
  assert.deepEqual(plan.queries.map((query) => query.targetField), [
    'snapshot.company_scale', 'company.local_operations', 'signals.recent_press', 'committee.target_roles', 'contact.role',
  ]);
  assert.ok(plan.queries[0].query.includes('site:acme.example'));
  assert.ok(plan.queries[1].query.includes('site:acme.example/peru/'));
  assert.ok(plan.queries[1].query.includes('Peru'));
  assert.ok(plan.queries[2].query.includes('2026'));
  assert.equal(plan.queries[2].recencyDays, 365);
  assert.ok(plan.queries[3].query.includes(input.targetTitles[0]));
  assert.ok(plan.queries[4].query.includes('Renata Perez'));
  assert.ok(plan.queries.every((query) => !query.query.includes('AND')));
});

test('domain is optional for fallback queries and unknown countries are not invented', () => {
  for (const companyDomain of ['', 'not a domain']) {
    const plan = normalizeResearchPlanV2(null, {
      ...input, entity: { ...entity, companyDomain, contactCountry: 'OTHER' },
    });
    assert.equal(plan.queries.length, 5);
    assert.ok(plan.queries.every((query) => !query.ownDomain && !query.query.includes('site:')));
    assert.ok(plan.queries.every((query) => query.query.includes('"Acme"')));
    assert.ok(plan.queries.every((query) => !/undefined|OTHER|not a domain/.test(query.query)));
  }
});

test('supports known local subdomains and does not make up contact names or roles', () => {
  const plan = normalizeResearchPlanV2(null, {
    ...input, targetTitles: [], entity: {
      ...entity, countryScopedPaths: { PE: 'pe.' },
      contact: { ...entity.contact, fullName: 'Unknown contact', title: 'Unknown title' },
    },
  });
  assert.equal(plan.queries.length, 4);
  assert.ok(plan.queries[1].query.includes('site:pe.acme.example'));
  assert.ok(plan.queries.every((query) => !query.query.includes('Unknown')));
  assert.ok(plan.queries[3].query.includes('directorio'));
});

test('malformed output produces a stable valid small plan without crashing', async () => {
  const expected = normalizeResearchPlanV2(null, input);
  for (const payload of [null, 42, 'invalid', [], {}, { queries: null }, { queries: [null, {}, { query: [] }] }]) {
    assert.deepEqual(normalizeResearchPlanV2(payload, input), expected);
    const plan = await planReportV2Research(input, { generate: async () => payload });
    assert.deepEqual(plan, expected);
    assert.ok(ResearchPlanV2Schema.safeParse(plan).success);
  }
});

test('normalizes a partial plan to all seven mandatory families with at most two own-domain queries', () => {
  const plan = normalizeResearchPlanV2({
    queries: Array.from({ length: 4 }, (_, index) => ({
      family: index % 2 ? 'press' : 'scale',
      query: `"GrupoExpro" query ${index}`,
      targetField: `field.${index}`,
      ownDomain: true,
      recencyDays: index % 2 ? 365 : null,
    })),
  }, { entity: grupoexproEntity(), targetTitles: ['Director Corporativo de Negocios'], industry: 'servicios transitorios', currentYear: 2026, depth: 'deep' });
  const families = new Set(plan.queries.map((query) => query.family));
  REQUIRED_REPORT_V2_QUERY_FAMILIES.forEach((family) => assert.ok(families.has(family), `Missing ${family}`));
  assert.ok(plan.queries.length >= 7 && plan.queries.length <= 12);
  assert.ok(plan.queries.filter((query) => query.ownDomain).length <= 2);
  assert.ok(plan.queries.find((query) => query.family === 'people')?.query.includes('Director Corporativo de Negocios'));
});

test('uses the deterministic emergency plan when OpenAI planning fails', async () => {
  const plan = await planReportV2Research({
    entity: grupoexproEntity(),
    sellerProfile: grupoexproGolden.sellerProfile,
    existingClaimsSummary: [],
    targetTitles: ['Director Corporativo de Negocios'],
    industry: 'servicios transitorios',
    currentYear: 2026,
    depth: 'deep',
  }, { generate: async () => { throw new Error('provider unavailable'); } });
  assert.deepEqual(new Set(plan.queries.map((query) => query.family)), new Set(REQUIRED_REPORT_V2_QUERY_FAMILIES));
  assert.ok(plan.queries.find((query) => query.family === 'press')?.query.includes('2026'));
});

test('express depth caps queries without dropping any required family', () => {
  const plan = normalizeResearchPlanV2({
    queries: [
      ...REQUIRED_REPORT_V2_QUERY_FAMILIES.map((family, index) => ({
        family,
        query: `"GrupoExpro" ${family} detalle ${index}`,
        targetField: `field.${family}`,
        ownDomain: index < 3,
        recencyDays: null,
      })),
      { family: 'awards', query: '"GrupoExpro" premios detalle', targetField: 'field.awards', ownDomain: false, recencyDays: null },
      { family: 'tech', query: '"GrupoExpro" tecnologia detalle', targetField: 'field.tech', ownDomain: false, recencyDays: null },
    ],
  }, { entity: grupoexproEntity(), targetTitles: ['Director Corporativo de Negocios'], industry: 'servicios transitorios', currentYear: 2026, depth: 'express' });
  const families = new Set(plan.queries.map((query) => query.family));
  REQUIRED_REPORT_V2_QUERY_FAMILIES.forEach((family) => assert.ok(families.has(family), `Missing ${family} under express`));
  assert.ok(plan.queries.length >= 6 && plan.queries.length <= 7);
  assert.ok(plan.queries.filter((query) => query.ownDomain).length <= 1);
});

test('express backfills required families when the model only returns optional ones', () => {
  const plan = normalizeResearchPlanV2({
    queries: [
      { family: 'awards', query: '"GrupoExpro" premios', targetField: 'field.awards', ownDomain: false, recencyDays: null },
      { family: 'tech', query: '"GrupoExpro" stack', targetField: 'field.tech', ownDomain: false, recencyDays: null },
    ],
  }, { entity: grupoexproEntity(), industry: 'servicios transitorios', currentYear: 2026, depth: 'express' });
  const families = new Set(plan.queries.map((query) => query.family));
  REQUIRED_REPORT_V2_QUERY_FAMILIES.forEach((family) => assert.ok(families.has(family), `Missing fallback ${family}`));
});

test('depth-aware normalization stays deterministic for the same input', () => {
  const value = {
    queries: REQUIRED_REPORT_V2_QUERY_FAMILIES.map((family) => ({
      family,
      query: `"GrupoExpro" ${family}`,
      targetField: `field.${family}`,
      ownDomain: false,
      recencyDays: null,
    })),
  };
  const depthInput = { entity: grupoexproEntity(), industry: 'servicios transitorios', currentYear: 2026, depth: 'standard' as const };
  assert.deepEqual(normalizeResearchPlanV2(value, depthInput), normalizeResearchPlanV2(value, depthInput));
});
