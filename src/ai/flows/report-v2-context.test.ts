import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeReportV2Context, stripInternalIdsForReportPrompt } from './write-report-v2-section';
import { buildAuditReportV2Prompt } from './audit-report-v2';
import { buildReasonReportV2Prompt } from './reason-about-report-v2-account';
import { writeReportV2 } from './write-report-v2';
import { briefReportV2Specialists } from './report-v2-specialists';
import { ClaimV2Schema, FactV2Schema } from '@/lib/report-v2-contracts';

function expand(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(expand);
  if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
    return value.rows.map((row: unknown[]) => Object.fromEntries(value.columns.map((key: string, index: number) => [key, expand(row[index])])));
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
}

const claims = Array.from({ length: 12 }, (_, index) => ClaimV2Schema.parse({
  id: `c${String(index + 1).padStart(2, '0')}`, internalId: `private-${index}`, type: 'fact',
  dimension: 'company_size', statement: `The group has ${index + 100} workers, not the Peru subsidiary.`,
  scope: 'group', jurisdiction: 'GLOBAL', confidence: 0.9, freshnessDays: null, observedAt: null,
  evidenceIds: ['f_aaaaaaaaaa'],
}));
const facts = [FactV2Schema.parse({
  id: 'f_aaaaaaaaaa', sourceId: 'src_aaaaaaaaaa', text: 'Exact evidence: "100 workers"\nGroup only. Reference 123e4567-e89b-42d3-a456-426614174000.',
  observedAt: null, jurisdiction: 'GLOBAL', locator: 'block:1',
}), FactV2Schema.parse({
  id: 'f_bbbbbbbbbb', sourceId: 'src_bbbbbbbbbb', text: 'Contradictory local evidence must also remain, even if uncited.',
  observedAt: '2026-01-01T00:00:00.000Z', jurisdiction: 'PE', locator: 'block:2',
})];

test('compact context round-trips all facts, scopes, short IDs and exact text without mutating inputs', () => {
  const input = { claims, facts };
  const original = JSON.stringify(input);
  const compact = serializeReportV2Context(input);
  assert.deepEqual(expand(JSON.parse(compact)), stripInternalIdsForReportPrompt(input, true));
  assert.equal(JSON.stringify(input), original);
  assert.ok(compact.length < original.length * 0.8);
  assert.ok(!compact.includes('private-'));
});

test('heterogeneous claims keep derivations, hypotheses, unknown scope and nested assumptions', () => {
  const input = [claims[0], { ...claims[1], type: 'hypothesis', scope: undefined, validationQuestion: 'How many workers are local?' }, {
    ...claims[2], type: 'derived', inputs: ['c01', 'c02'], formula: 'c01 * multiplier',
    assumptions: [{ id: 'asm_aaaaaaaaaa', label: 'Multiplier', value: 2, rationale: 'Configured assumption, not a fact.', editable: true }],
  }];
  assert.deepEqual(expand(JSON.parse(serializeReportV2Context(input))), JSON.parse(JSON.stringify(stripInternalIdsForReportPrompt(input, true))));
  for (const value of [null, [], {}, ['c01', 'c02'], [{ id: 'c01' }], [null, { id: 'c01' }]]) {
    assert.deepEqual(expand(JSON.parse(serializeReportV2Context(value))), value);
    assert.ok(serializeReportV2Context(value).length <= JSON.stringify(value).length);
  }
});

test('analyst, all specialists, editor and repair retain the complete compact claim index', async () => {
  const input = { entity: { contactCountry: 'PE', contact: { title: 'Coordinator' } }, qualification: {}, claims, sellerProfile: { products: [] }, analysis: {}, language: 'es' } as any;
  const encoded = serializeReportV2Context(claims);
  assert.ok(buildReasonReportV2Prompt(input).includes(encoded));
  const specialists = await briefReportV2Specialists(input, { generate: (async (options: any) => {
    assert.ok(options.prompt.includes(encoded));
    const brief = { observations: [], opportunities: [], questions: [] };
    return { data: { company: brief, contact: brief, sector: brief }, telemetry: {} };
  }) as any });
  assert.equal(specialists.length, 3);
  assert.ok(specialists.every((specialist) => specialist.error === null));
  const repair = { sections: [{ key: 'company', title: 'Company', paragraphs: [{ text: facts[0].text, basis: 'source', claimIds: ['c01'], context: 'headquarters' }], blocks: [] }], issues: [{ fragment: facts[0].text }] };
  await writeReportV2({ ...input, repair }, { generate: (async (options: any) => {
    assert.ok(options.prompt.includes(encoded));
    assert.ok(options.prompt.includes(serializeReportV2Context(repair.sections)));
    assert.ok(options.prompt.includes(serializeReportV2Context(repair.issues)));
    return { data: { sections: [] }, telemetry: {} };
  }) as any });
});

test('auditor receives every passage including uncited contradictions and exact paragraph indexes', () => {
  const sections = [{ key: 'company', title: 'Company', blocks: [], paragraphs: claims.map((claim) => ({ text: claim.statement, claimIds: [claim.id], basis: 'source', context: 'headquarters' })) }];
  const prompt = buildAuditReportV2Prompt({ sections, claims, facts, claimIds: claims.map((claim) => claim.id), contactCountry: 'PE' } as any);
  for (const [label, expected] of [['Secciones a auditar', sections], ['Afirmaciones y alcance real', claims], ['Pasajes de respaldo', facts]] as const) {
    const line = prompt.split('\n').find((line) => line.startsWith(`${label}: `))!;
    assert.deepEqual(expand(JSON.parse(line.slice(label.length + 2))), stripInternalIdsForReportPrompt(expected, true));
  }
  assert.match(prompt, /citas falsas/);
  assert.match(prompt, /datos de grupo presentados como locales/);
});
