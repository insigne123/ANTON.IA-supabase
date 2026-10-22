import assert from 'node:assert/strict';
import test from 'node:test';
import { claudeRequest } from '@/ai/anthropic-json';
import { reportSchema } from './expedient';
import { BUYER_QUESTION_RULE, PRIVATE_PROCESS_RULE, SIGNAL_QUESTION_RULE, opportunityReportPrompt, opportunitySynthesisSources, readOpportunityReportEnvelope, reportEnvelopeSchema } from './report-generation';

const report = () => ({
  title: 'Oportunidad de prueba', executive: 'Empresa por acreditar; bases parciales.', recommendation: 'insufficient', reasons: ['Faltan bases'],
  sections: Array.from({ length: 5 }, (_, i) => ({ id: `section-${i}`, title: `Sección ${i}`, paragraphs: ['Texto con "comillas", salto\nde línea y áéíóú.'], facts: [] })),
  requirements: [], tasks: [], milestones: [], risks: [], scenarios: [], questions: [], warnings: ['Inventario no confirmado'], nextSteps: ['Subir las bases'],
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

test('original synthesis sources keep exact chunk identity and text, counted by UTF8 bytes', () => {
  const chunks = [{ id: 'question', document_id: 'forum', ordinal: 0, locator: 'Bloque 1', content: '¿Lo proveerá el hospital?\nRespuesta: SÍ' },
    { id: 'amount', document_id: 'ficha', ordinal: 0, locator: 'Bloque 2', content: 'Monto: $500.000' }];
  const full = opportunitySynthesisSources(chunks);
  assert.equal(full.omittedChunks, 0);
  assert.equal(full.chunks[0].content, chunks[0].content);
  assert.equal(full.chunks[0].id, 'question');
  assert.equal(full.bytes, new TextEncoder().encode(JSON.stringify(full.chunks)).length);
  const bounded = opportunitySynthesisSources(chunks, full.bytes - 1);
  assert.equal(bounded.omittedChunks, 1);
  assert.ok(bounded.bytes <= full.bytes - 1);
  assert.equal(opportunitySynthesisSources(chunks, 2).chunks.length, 0);
});

test('the report reads like a decision for a busy person and a LinkedIn signal gets a commercial outline, not a tender one', () => {
  const tender = opportunityReportPrompt('2026-10-15', {}, 'tender');
  assert.match(tender, /Requisitos para postular y qué falta/);
  assert.match(tender, /como máximo 90 palabras/);
  assert.match(tender, /nunca en formato ISO/);
  assert.match(tender, /nunca de «workspace», «radar», «ficha», «campo», «null»/);
  assert.doesNotMatch(tender, /son para recalcular con código|ofrece fórmulas paramétricas/);
  const signal = opportunityReportPrompt('2026-10-15', {}, 'hiring');
  assert.match(signal, /No es una licitación/);
  assert.match(signal, /A quién contactar/);
  assert.doesNotMatch(signal, /garantías, pagos y multas;/);
  const schema = JSON.parse(tender.split('\n').find(line => line.startsWith('{') && line.includes('"properties"'))!);
  assert.equal(schema.properties.nextSteps.maxItems, 3);
});

test('the report asks for every question the person needs to ask, in a complete form: the buyer for a purchase, the first conversation for a signal', () => {
  const tender = opportunityReportPrompt('2026-10-13', {}, 'tender');
  assert.ok(tender.includes(BUYER_QUESTION_RULE));
  for (const part of ['haz TODAS las que la empresa necesite', 'dónde está la duda (documento y punto o cláusula)', 'cada contradicción o inconsistencia', 'visitas a terreno obligatorias',
    'neto o con IVA', 'criterios de evaluación y desempate', 'uniones temporales', 'No preguntes lo que las bases o las respuestas del foro ya contestan', 'nunca dejes sin preguntar una contradicción']) assert.ok(BUYER_QUESTION_RULE.toLowerCase().includes(part.toLowerCase()), part);
  assert.ok(!tender.includes(SIGNAL_QUESTION_RULE));
  const signal = opportunityReportPrompt('2026-10-13', {}, 'hiring');
  assert.ok(signal.includes(SIGNAL_QUESTION_RULE) && !signal.includes(BUYER_QUESTION_RULE));
});

test('a private process is written up as one: its schedule, platform, forms and framework contract, and no public-procurement rules', () => {
  const prompt = opportunityReportPrompt('2026-10-22', {}, 'private');
  assert.ok(prompt.includes(PRIVATE_PROCESS_RULE));
  assert.match(prompt, /no apliques Mercado Público, la Ley 19\.886 ni el Registro de Proveedores/);
  assert.match(prompt, /Cronograma y cómo se presenta \(plataforma, formularios y cotización\)/);
  assert.match(prompt, /Condiciones del contrato: garantías, seguros, pagos, reajuste y multas/);
  assert.match(prompt, /el contrato marco y sus condiciones suelen no serlo/);
  assert.match(prompt, /sin inventar cifras/);
  // A public tender keeps its own outline and does not get the private rules; a signal is untouched.
  for (const kind of ['tender', 'compra_agil', undefined]) {
    const other = opportunityReportPrompt('2026-10-22', {}, kind);
    assert.ok(!other.includes(PRIVATE_PROCESS_RULE));
    assert.match(other, /Condiciones del contrato: garantías, pagos y multas/);
  }
  assert.ok(!opportunityReportPrompt('2026-10-22', {}, 'hiring').includes(PRIVATE_PROCESS_RULE));
});
