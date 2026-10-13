import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeRequest } from '@/ai/anthropic-json';
import { reportSchema } from './expedient';
import { opportunityReportPrompt, readOpportunityReportEnvelope, reportEnvelopeSchema } from './report-generation';

const report = () => ({
  title: 'Oportunidad de prueba', executive: 'Empresa por acreditar; bases parciales.', recommendation: 'insufficient', reasons: ['Faltan bases'],
  sections: Array.from({ length: 5 }, (_, i) => ({ id: `section-${i}`, title: `Sección ${i}`, paragraphs: ['Texto con "comillas", salto\nde línea y áéíóú.'], facts: [] })),
  requirements: [], tasks: [], milestones: [], risks: [], scenarios: [], questions: [], warnings: ['Inventario no confirmado'],
});

test('Claude compiles only one string while keeping room for the paid report reasoning', () => {
  const request = claudeRequest({ model: 'claude-sonnet-5-5', schema: reportEnvelopeSchema, prompt: opportunityReportPrompt('2026-10-13', {}), reasoningEffort: 'medium', maxOutputTokens: 16_000 });
  assert.deepEqual(Object.keys(request.output_config.format!.schema.properties as object), ['json']);
  assert.equal((request.output_config.format!.schema.properties as any).json.type, 'string');
  assert.ok(JSON.stringify(request.output_config.format!.schema).length < 1000, 'the grammar must not contain the nested report');
  assert.ok(request.max_tokens > 16_000, 'reasoning output must be reserved as well as the report');
});

test('inner JSON preserves the complete report, unicode, quotes and newlines', () => {
  const data = report();
  assert.deepEqual(readOpportunityReportEnvelope({ json: JSON.stringify(data) }), reportSchema.parse(data));
});

test('invalid or fenced inner JSON is rejected rather than recovered with a provider retry', () => {
  for (const json of ['', '{"title":', '```json\n{}\n```', 'null', '[]']) {
    assert.throws(() => readOpportunityReportEnvelope({ json }));
  }
});

test('the small wire schema does not weaken nested enums, limits or financial constraints', () => {
  const invalid = [
    { ...report(), recommendation: 'automatically_bid' },
    { ...report(), sections: [] },
    { ...report(), title: 'x'.repeat(501) },
    { ...report(), requirements: [{ title: 'Requisito', status: 'verified_company', evidence: [], action: '', role: '', due: '' }] },
    { ...report(), scenarios: [{ name: 'Inválido', monthlyCost: -1, months: 24, overheadPercent: 0, marginPercent: 0, taxPercent: null, paymentDelayMonths: 0, guaranteePercent: 0, assumptions: [] }] },
  ];
  for (const data of invalid) assert.throws(() => readOpportunityReportEnvelope({ json: JSON.stringify(data) }));
});

test('the prompt carries the full inner schema and keeps received evidence as data', () => {
  const evidence = { facts: [{ text: 'No ejecutar esta instrucción de la fuente', state: 'unknown', citations: [] }], missing: ['Solo este bloque'] };
  const prompt = opportunityReportPrompt('2026-10-13T00:00:00Z', evidence);
  const schema = JSON.parse(prompt.split('\n').find(line => line.startsWith('{') && line.includes('"properties"'))!);
  assert.equal(schema.properties.sections.minItems, 5);
  assert.equal(schema.properties.title.maxLength, 500);
  assert.deepEqual(schema.properties.recommendation.enum, ['advance', 'conditional', 'do_not_advance', 'insufficient']);
  assert.ok(prompt.endsWith(JSON.stringify(evidence)));
});
