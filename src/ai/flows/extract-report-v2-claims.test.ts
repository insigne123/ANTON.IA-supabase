import assert from 'node:assert/strict';
import test from 'node:test';

import type { generateStructured } from '@/ai/openai-json';
import { ClaimV2Schema, type ClaimV2, type FactV2, type SourceV2 } from '@/lib/report-v2-contracts';
import type { ParsedWebEvidenceV2 } from '@/lib/report-v2-extraction';
import { buildStableReportV2Id } from '@/lib/report-v2-ids';
import {
  REPORT_V2_TARGET_FIELDS,
  consolidateReportV2Claims,
  dedupeExtractedClaimDrafts,
  extractClaimsFromSourceV2,
  extractClaimsFromSourcesV2,
  projectExtractedClaimDraftsForModel,
  pruneExtractedClaimDrafts,
  type ExtractedClaimDraftV2,
} from './extract-report-v2-claims';

const capturedAt = '2026-09-08T00:00:00.000Z';
type ModelClaim = Omit<ExtractedClaimDraftV2, 'internalId' | 'type' | 'freshnessDays' | 'scope'> & {
  scope: NonNullable<ClaimV2['scope']> | null;
};
type GenerateOptions = Parameters<typeof generateStructured>[0];

function source(blocks: string[], metadata: Partial<SourceV2> = {}): ParsedWebEvidenceV2 {
  return {
    source: {
      id: buildStableReportV2Id('src', { blocks, metadata }),
      url: 'https://acme.example/peru/',
      canonicalUrl: 'https://acme.example/peru/',
      title: 'Acme institucional',
      sourceType: 'corporate',
      jurisdiction: 'PE',
      publishedAt: '2026-09-01T00:00:00.000Z',
      modifiedAt: '2026-09-06T00:00:00.000Z',
      retrievedAt: capturedAt,
      ownDomain: true,
      contentHash: 'a'.repeat(64),
      ...metadata,
    },
    blocks,
    text: blocks.join('\n'),
    metaDescription: null,
    headings: [],
    tables: [],
    links: [],
    jsonLd: [],
    numbers: [],
  };
}

function input(evidence: ParsedWebEvidenceV2) {
  return {
    companyName: 'Acme',
    companyDomain: 'acme.example',
    source: evidence,
    providerContext: { title: 'Directora de Finanzas', company: 'Acme' },
    existingClaims: [],
    capturedAt,
  };
}

function modelClaim(fact: FactV2, overrides: Partial<ModelClaim> = {}): ModelClaim {
  return {
    targetField: 'headcount_managed',
    dimension: 'company_size',
    statement: 'Acme gestiona 300 colaboradores.',
    evidenceIds: [fact.id],
    observedAt: null,
    jurisdiction: 'PE',
    scope: 'country',
    confidence: 0.88,
    ...overrides,
  };
}

function promptFacts(options: GenerateOptions): FactV2[] {
  const line = options.prompt.split('\n').find((value) => value.startsWith('Evidencia: '));
  assert.ok(line);
  const evidence = JSON.parse(line.slice('Evidencia: '.length));
  return Array.isArray(evidence) ? evidence : evidence.rows.map((row: unknown[]) => Object.fromEntries(evidence.columns.map((key: string, index: number) => [key, row[index]])));
}

function model(build: (facts: FactV2[]) => ModelClaim[], calls: GenerateOptions[] = []): typeof generateStructured {
  return async (options) => {
    calls.push(options);
    const claims = build(promptFacts(options));
    return options.schema.parse({
      claims,
      notFoundFields: REPORT_V2_TARGET_FIELDS.filter((field) => !claims.some((claim) => claim.targetField === field)),
    });
  };
}

test('accepts a real non-empty Luna payload through the strict claim contract, including undated evergreen facts', async () => {
  const evidence = source([
    'Acme gestiona 300 colaboradores en Peru.',
    'Acme trabaja con 40 clientes en Peru.',
    'Acme tiene su sede en Lima, Peru.',
    'Renata Perez es Directora de Finanzas de Acme.',
    'Acme presta servicios de seleccion de personal.',
  ]);
  const calls: GenerateOptions[] = [];
  const extracted = await extractClaimsFromSourceV2(input(evidence), {
    generate: model((facts) => [
      modelClaim(facts[0]),
      modelClaim(facts[1], { targetField: 'client_count', statement: 'Acme trabaja con 40 clientes en Peru.' }),
      modelClaim(facts[2], { targetField: 'headquarters', dimension: 'company_geography', statement: 'Acme tiene su sede en Lima, Peru.' }),
      modelClaim(facts[3], { targetField: 'executives', dimension: 'buying_committee', statement: 'Renata Perez es Directora de Finanzas de Acme.', scope: 'person', jurisdiction: null }),
      modelClaim(facts[4], { targetField: 'services', dimension: 'company_service', statement: 'Acme presta servicios de seleccion de personal.', scope: null, jurisdiction: null }),
    ], calls),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'openai');
  assert.equal(calls[0].allowDefaultModelFallback, false);
  assert.equal(calls[0].openAiModels?.[0], 'gpt-5.6-luna');
  assert.deepEqual(calls[0].openAiModels, ['gpt-5.6-luna']);
  assert.equal(extracted.errorCode, null);
  assert.equal(extracted.claims.length, 5);
  assert.ok(extracted.claims.every((claim) => claim.observedAt === null && claim.freshnessDays === null));
  assert.ok(extracted.facts.every((fact) => fact.observedAt === null && fact.jurisdiction === null));
  assert.equal(extracted.source.publishedAt, evidence.source.publishedAt);
  assert.ok(!extracted.notFoundFields.includes('headcount_managed'));
  assert.ok(extracted.notFoundFields.includes('recent_events'));

  const consolidated = consolidateReportV2Claims({ drafts: extracted.claims, facts: extracted.facts });
  assert.equal(consolidated.claims.length, 5);
  assert.ok(consolidated.claims.every((claim) => ClaimV2Schema.safeParse(claim).success));
  assert.ok(consolidated.claims.every((claim) => !('targetField' in claim)));
  assert.equal(consolidated.claims.find((claim) => claim.dimension === 'company_service')?.scope, undefined);
  assert.deepEqual(new Set(consolidated.claims.flatMap((claim) => claim.evidenceIds)), new Set(extracted.facts.map((fact) => fact.id)));
});

test('preserves group and unknown scope without turning a Peru source path into a local size', async () => {
  const evidence = source(['Acme tiene 12000 colaboradores en el grupo multinacional.'], { publishedAt: null, modifiedAt: null });
  const extracted = await extractClaimsFromSourceV2(input(evidence), {
    generate: model((facts) => [modelClaim(facts[0], {
      statement: 'El grupo Acme tiene 12000 colaboradores.', scope: 'group', jurisdiction: 'GLOBAL',
    })]),
  });
  assert.equal(extracted.errorCode, null);
  assert.equal(extracted.claims[0].scope, 'group');
  assert.equal(extracted.claims[0].jurisdiction, 'GLOBAL');
  assert.equal(extracted.claims[0].observedAt, null);
  assert.equal(extracted.claims[0].freshnessDays, null);
  const { claims } = consolidateReportV2Claims({ drafts: extracted.claims, facts: extracted.facts });
  assert.equal(claims[0].scope, 'group');
  assert.equal(claims[0].jurisdiction, 'GLOBAL');
});

test('uses the real date of a relevant event, not the later publication or modification date', async () => {
  const evidence = source(['El 15 de agosto de 2026 Acme abrio un centro de distribucion en Lima para atender la operacion local.'], {
    sourceType: 'press', ownDomain: false,
  });
  const extracted = await extractClaimsFromSourceV2(input(evidence), {
    generate: model((facts) => [modelClaim(facts[0], {
      targetField: 'recent_events', dimension: 'signal',
      statement: 'Acme abrio un centro de distribucion en Lima el 15 de agosto de 2026.',
      observedAt: '2026-08-15T00:00:00-05:00',
    })]),
  });
  assert.equal(extracted.errorCode, null);
  assert.equal(extracted.claims.length, 1);
  assert.equal(extracted.claims[0].observedAt, '2026-08-15T05:00:00.000Z');
  assert.equal(extracted.claims[0].freshnessDays, 23);
  assert.equal(extracted.facts[0].observedAt, null);
});

test('a news headline does not invalidate an event independently supported by the dated article body', async () => {
  const title = 'Acme abrio un centro de distribucion en Lima.';
  const evidence = source([title, 'Acme abrio un centro de distribucion en Lima el 15 de agosto de 2026 para ampliar la operacion local.'], {
    title, sourceType: 'press', ownDomain: false,
  });
  const extracted = await extractClaimsFromSourceV2(input(evidence), {
    generate: model((facts) => [modelClaim(facts[1], {
      targetField: 'recent_events', dimension: 'signal', statement: title, observedAt: '2026-08-15T00:00:00.000Z',
    })]),
  });
  assert.equal(extracted.errorCode, null);
  assert.equal(extracted.claims.length, 1);
  assert.deepEqual(extracted.claims[0].evidenceIds, [extracted.facts[1].id]);
});

test('does not date an undated news event from metadata and keeps valid evergreen siblings', async () => {
  const extracted = await extractClaimsFromSourceV2(input(source([
    'Acme abrio un centro de distribucion en Lima.',
    'Acme gestiona 300 colaboradores en Peru.',
  ], { sourceType: 'press', ownDomain: false })), {
    generate: model((facts) => [
      modelClaim(facts[0], { targetField: 'recent_events', dimension: 'signal', statement: 'Acme abrio un centro de distribucion en Lima.' }),
      modelClaim(facts[1]),
    ]),
  });
  assert.equal(extracted.errorCode, 'claim_extraction_invalid_output');
  assert.equal(extracted.claims.length, 1);
  assert.equal(extracted.claims[0].dimension, 'company_size');
  assert.equal(extracted.claims[0].observedAt, null);
  assert.ok(extracted.notFoundFields.includes('recent_events'));
});

test('rejects future events and corporate navigation labels even when the model supplies a date', async () => {
  const evidence = source(['Acme planea abrir una sede el 1 de octubre de 2026.', 'Acme institucional']);
  const extracted = await extractClaimsFromSourceV2(input(evidence), {
    generate: model((facts) => [
      modelClaim(facts[0], { targetField: 'recent_events', dimension: 'signal', statement: 'Acme abrira una sede.', observedAt: '2026-10-01T00:00:00.000Z' }),
      modelClaim(facts[1], { targetField: 'recent_events', dimension: 'signal', statement: evidence.source.title, observedAt: evidence.source.publishedAt }),
    ]),
  });
  assert.deepEqual(extracted.claims, []);
  assert.equal(extracted.errorCode, 'claim_extraction_invalid_output');
});

test('model failure warns without inventing claims or LinkedIn, corporate-title and numeric signals', async () => {
  const evidence = source([
    'Acme: expansion y contratacion',
    'Acme tiene 5300 seguidores y 900 personas asociadas en LinkedIn.',
    'Acme gestiona 300 colaboradores y trabaja con 40 clientes.',
  ], { sourceType: 'social', title: 'Acme: expansion y contratacion' });
  const extracted = await extractClaimsFromSourceV2(input(evidence), {
    generate: async () => { throw new Error('provider unavailable'); },
  });
  assert.equal(extracted.errorCode, 'claim_extraction_failed');
  assert.deepEqual(extracted.claims, []);
  assert.equal(extracted.facts.length, 3);
  assert.deepEqual(extracted.notFoundFields, [...REPORT_V2_TARGET_FIELDS]);

  const empty = await extractClaimsFromSourceV2(input(evidence), { generate: model(() => []) });
  assert.equal(empty.errorCode, null);
  assert.deepEqual(empty.claims, []);
});

test('LinkedIn followers and associated profiles remain non-events even in a dated model payload', async () => {
  const extracted = await extractClaimsFromSourceV2(input(source([
    'Al 1 de septiembre de 2026 Acme registra 5300 seguidores en LinkedIn.',
    'El perfil de Acme muestra 900 personas asociadas en LinkedIn.',
  ], { sourceType: 'social' })), {
    generate: model((facts) => facts.map((fact) => modelClaim(fact, {
      targetField: 'recent_events', dimension: 'signal', statement: fact.text, observedAt: '2026-09-01T00:00:00.000Z',
    }))),
  });
  assert.equal(extracted.errorCode, 'claim_extraction_invalid_output');
  assert.deepEqual(extracted.claims, []);
  assert.equal(extracted.facts.length, 2);
});

test('one failed source does not cancel a non-empty valid model result from another source', async () => {
  const first = source(['Acme gestiona 300 colaboradores.']);
  const second = source(['Acme gestiona 500 colaboradores en Chile.'], { jurisdiction: 'CL' });
  let calls = 0;
  const successfulModel = model((facts) => [modelClaim(facts[0], { statement: 'Acme gestiona 500 colaboradores en Chile.', jurisdiction: 'CL' })]);
  const extracted = await extractClaimsFromSourcesV2({ ...input(first), sources: [first, second] }, {
    generate: async (options) => {
      calls += 1;
      if (calls === 1) throw new Error('source failure');
      return successfulModel(options);
    },
  });
  assert.equal(calls, 2);
  assert.equal(extracted.results.length, 2);
  assert.deepEqual(extracted.failedSourceIds, [first.source.id]);
  assert.equal(extracted.claimDrafts.length, 1);
  assert.equal(extracted.claimDrafts[0].jurisdiction, 'CL');
  assert.equal(extracted.facts.length, 2);
});

test('malformed siblings cannot crash date conversion, discard valid output, or silently trim invalid citations', async () => {
  const evidence = source(['Acme gestiona 300 colaboradores.']);
  const generate: typeof generateStructured = async (options) => {
    const valid = modelClaim(promptFacts(options)[0]);
    return {
      claims: [
        valid, null, 42, {},
        { ...valid, observedAt: 'not-a-date' },
        { ...valid, observedAt: '2026-02-31T00:00:00.000Z' },
        { ...valid, observedAt: '2026-08-01T00:00:00+99:99' },
        { ...valid, observedAt: {} },
        { ...valid, scope: 'subsidiary' },
        { ...valid, confidence: Number.NaN },
        { ...valid, statement: '<div>Acme</div>' },
        { ...valid, evidenceIds: [...valid.evidenceIds, 'f_0000000000'] },
        { ...valid, evidenceIds: [] },
      ],
      notFoundFields: [],
    };
  };
  const first = await extractClaimsFromSourceV2(input(evidence), { generate });
  const second = await extractClaimsFromSourceV2(input(evidence), { generate });
  assert.equal(first.errorCode, 'claim_extraction_invalid_output');
  assert.equal(first.claims.length, 1);
  assert.deepEqual(first.claims[0].evidenceIds, [first.facts[0].id]);
  assert.deepEqual(first, second);
});

test('P4 merges duplicate support and reports conflicting numeric values', () => {
  const factA = {
    id: 'f_aaaaaaaaaa', sourceId: 'src_aaaaaaaaaa', text: 'Acme has 100 workers.',
    observedAt: '2026-01-01T00:00:00.000Z', jurisdiction: 'PE' as const, locator: null,
  };
  const factB = {
    id: 'f_bbbbbbbbbb', sourceId: 'src_bbbbbbbbbb', text: 'Acme has 200 workers.',
    observedAt: '2026-01-01T00:00:00.000Z', jurisdiction: 'PE' as const, locator: null,
  };
  const common = {
    type: 'fact' as const,
    dimension: 'company_size' as const,
    targetField: 'headcount_managed' as const,
    freshnessDays: 1,
    jurisdiction: 'PE' as const,
    scope: 'country' as const,
    confidence: 0.8,
  };
  const result = consolidateReportV2Claims({
    facts: [factA, factB],
    drafts: [
      { ...common, internalId: 'internal-a', statement: 'Acme has 100 workers.', evidenceIds: [factA.id], observedAt: factA.observedAt },
      { ...common, internalId: 'internal-b', statement: 'Acme has 200 workers.', evidenceIds: [factB.id], observedAt: factB.observedAt },
    ],
  });
  assert.equal(result.claims.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.claims.map((claim) => claim.id), ['c01', 'c02']);
});

test('malformed envelopes fail stably without pseudo claims', async () => {
  const evidence = source(['Acme gestiona 300 colaboradores.']);
  for (const payload of [null, false, 'invalid', [], {}, { claims: null }, { claims: 'invalid' }, { claims: [null] }]) {
    const extracted = await extractClaimsFromSourceV2(input(evidence), { generate: async () => payload });
    assert.equal(extracted.errorCode, 'claim_extraction_invalid_output');
    assert.deepEqual(extracted.claims, []);
  }
});

test('empty sources do not invoke the model', async () => {
  let calls = 0;
  const extracted = await extractClaimsFromSourceV2(input(source([])), {
    generate: async () => { calls += 1; throw new Error('unexpected model call'); },
  });
  assert.equal(calls, 0);
  assert.equal(extracted.errorCode, 'empty_source');
});

const factA: FactV2 = {
  id: 'f_aaaaaaaaaa', sourceId: 'src_aaaaaaaaaa', text: 'Acme gestiona 300 colaboradores.',
  observedAt: null, jurisdiction: null, locator: null,
};
const factB: FactV2 = { ...factA, id: 'f_bbbbbbbbbb', sourceId: 'src_bbbbbbbbbb' };
const common: ExtractedClaimDraftV2 = {
  internalId: 'internal-a', type: 'fact', targetField: 'headcount_managed', dimension: 'company_size',
  statement: 'Acme gestiona 300 colaboradores.', evidenceIds: [factA.id], observedAt: '2026-08-01T00:00:00.000Z',
  freshnessDays: 38, jurisdiction: 'PE', scope: 'country', confidence: 0.8,
};

test('consolidation merges all duplicate citations and reports only a comparable numeric conflict', () => {
  const factC = { ...factB, id: 'f_cccccccccc', text: 'Acme gestiona 500 colaboradores.' };
  const drafts = [
    common,
    { ...common, internalId: 'internal-b', evidenceIds: [factB.id], confidence: 0.9 },
    { ...common, internalId: 'internal-c', evidenceIds: [factC.id], statement: factC.text },
  ];
  const result = consolidateReportV2Claims({ facts: [factA, factB, factC], drafts });
  assert.equal(result.claims.length, 2);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.claims[0].evidenceIds, [factA.id, factB.id]);
  assert.equal(result.claims[0].confidence, 0.9);
  assert.deepEqual(result.claims.map((claim) => claim.id), ['c01', 'c02']);
  assert.deepEqual(new Set(result.claims.flatMap((claim) => claim.evidenceIds)), new Set([factA.id, factB.id, factC.id]));
  assert.deepEqual(result, consolidateReportV2Claims({ facts: [factA, factB, factC], drafts: [...drafts].reverse() }));
});

test('different country, scope, metric, date and unknown context are not numeric conflicts', () => {
  const alternatives: Partial<ExtractedClaimDraftV2>[] = [
    { jurisdiction: 'CL' },
    { scope: 'group' },
    { observedAt: '2026-07-01T00:00:00.000Z' },
    { observedAt: null },
    { scope: undefined },
    { jurisdiction: null },
    { targetField: 'client_count' },
    { statement: 'Acme emplea 500 colaboradores internos.' },
    { statement: 'Acme gestiona mas de 500 colaboradores.' },
  ];
  for (const alternative of alternatives) {
    const result = consolidateReportV2Claims({
      facts: [factA, factB],
      drafts: [common, { ...common, internalId: 'internal-b', evidenceIds: [factB.id], statement: 'Acme gestiona 500 colaboradores.', ...alternative }],
    });
    assert.equal(result.claims.length, 2);
    assert.deepEqual(result.conflicts, [], JSON.stringify(alternative));
  }
  const undated = consolidateReportV2Claims({ facts: [factA, factB], drafts: [
    { ...common, observedAt: null },
    { ...common, internalId: 'internal-b', evidenceIds: [factB.id], observedAt: null, statement: 'Acme gestiona 500 colaboradores.' },
  ] });
  assert.deepEqual(undated.conflicts, []);
});

test('deduplication and internal IDs preserve identical wording with different scope, country, metric or date', async () => {
  const evidence = source(['Acme gestiona 300 colaboradores en Peru; el grupo y la empresa reportan tambien esa cifra.']);
  const extracted = await extractClaimsFromSourceV2(input(evidence), { generate: model((facts) => [
    modelClaim(facts[0]),
    modelClaim(facts[0], { scope: 'group' }),
    modelClaim(facts[0], { scope: 'company' }),
    modelClaim(facts[0], { scope: null }),
  ]) });
  assert.equal(extracted.errorCode, null);
  assert.equal(new Set(extracted.claims.map((claim) => claim.internalId)).size, 4);
  const variations: Partial<ExtractedClaimDraftV2>[] = [
    {}, { scope: 'group' }, { jurisdiction: 'CL' }, { targetField: 'client_count' },
    { observedAt: null }, { observedAt: '2026-07-01T00:00:00.000Z' },
  ];
  const result = consolidateReportV2Claims({ facts: [factA], drafts: variations.map((variation, index) => ({
    ...common, ...variation, internalId: `internal-${index}`,
  })) });
  assert.equal(result.claims.length, variations.length);
  assert.ok(result.claims.every((claim) => claim.evidenceIds.some((id) => id === factA.id)));
  assert.deepEqual(result.conflicts, []);
});

test('numeric comparison distinguishes decimals but not thousands formatting', () => {
  for (const [left, right, count] of [['10.000', '10000', 0], ['1.5', '15', 1]] as const) {
    const result = consolidateReportV2Claims({ facts: [factA, factB], drafts: [
      { ...common, targetField: 'years_operating', dimension: 'company_overview', statement: `Acme declara ${left} anos de operacion.` },
      { ...common, internalId: 'internal-b', evidenceIds: [factB.id], targetField: 'years_operating', dimension: 'company_overview', statement: `Acme declara ${right} anos de operacion.` },
    ] });
    assert.equal(result.conflicts.length, count);
  }
});

const draftFixture = (overrides: Record<string, unknown> = {}) => ({
  internalId: `internal-${String(overrides.statement || 'x').length}-${Math.random().toString(36).slice(2, 6)}`,
  type: 'fact' as const,
  dimension: 'company_size' as const,
  statement: 'Acme gestiona 12000 colaboradores.',
  evidenceIds: ['f_aaaaaaaaaa'],
  observedAt: '2026-01-01T00:00:00.000Z',
  freshnessDays: 1,
  jurisdiction: 'PE' as const,
  confidence: 0.8,
  targetField: 'headcount_managed' as const,
  ...overrides,
});

test('draft dedup merges near-duplicates and unions evidence without network calls', () => {
  const drafts = [
    draftFixture({ internalId: 'internal-a', statement: 'Acme gestiona 12000 colaboradores en Chile y Peru.', evidenceIds: ['f_aaaaaaaaaa'], confidence: 0.7 }),
    draftFixture({ internalId: 'internal-b', statement: 'Acme gestiona 12000 colaboradores en Chile y Peru confirmados.', evidenceIds: ['f_bbbbbbbbbb'], confidence: 0.9 }),
    draftFixture({ internalId: 'internal-c', statement: 'Acme opera en el sector de servicios transitorios.', dimension: 'company_industry', targetField: 'industry', evidenceIds: ['f_cccccccccc'], confidence: 0.8 }),
  ];
  const deduped = dedupeExtractedClaimDrafts(drafts);
  assert.equal(deduped.length, 2);
  const merged = deduped.find((draft) => draft.targetField === 'headcount_managed');
  assert.equal(merged?.internalId, 'internal-a');
  assert.deepEqual(merged?.evidenceIds, ['f_aaaaaaaaaa', 'f_bbbbbbbbbb']);
  assert.equal(merged?.confidence, 0.9);
});

test('draft pruning caps per target field and total deterministically', () => {
  const statements = [
    'Acme gestiona 12000 colaboradores en Chile y Perú.',
    'Acme declara trabajar con 850 clientes corporativos regionales.',
    'La dotación publicada supera las 4000 personas contratadas.',
    'El reporte anual informa 3200 empleos directos vigentes.',
    'La nómina total bordea los 9100 trabajadores activos.',
    'Se publicaron 640 vacantes operativas durante el trimestre.',
    'La planilla registrada alcanza 7700 puestos formales.',
    'El censo interno contabiliza 5800 funcionarios contratados.',
  ];
  const drafts = statements.map((statement, index) => draftFixture({
    internalId: `internal-${index}`,
    statement,
    evidenceIds: [`f_evidence_${index}`],
    confidence: 0.5 + index / 100,
  }));
  const first = pruneExtractedClaimDrafts(drafts, { maxTotal: 3, maxPerTargetField: 2 });
  const second = pruneExtractedClaimDrafts(drafts, { maxTotal: 3, maxPerTargetField: 2 });
  assert.deepEqual(first.map((draft) => draft.internalId), second.map((draft) => draft.internalId));
  assert.equal(first.length, 2);
  assert.ok(first[0].confidence >= first[1].confidence);
  const projection = projectExtractedClaimDraftsForModel(drafts, { maxTotal: 3, maxPerTargetField: 2 });
  assert.equal(projection.totals.total, 8);
  assert.equal(projection.pruned, 8 - projection.drafts.length);
  assert.equal(drafts.length, 8);
});
