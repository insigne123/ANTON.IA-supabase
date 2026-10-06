import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkBlock } from './contracts';
import { coworkBlocks } from './answer-quality';
import { coworkBlocksText, coworkBlockMeta, coworkChartCsv, coworkChartHeadline, coworkChartSummary, coworkChartValue } from './blocks';
import { coworkChartCandidates, coworkWithCharts } from './charts';
import { runCoworkReadLoop } from './agent-loop';

const period = (sent: number, humanReplies: number, positives: number, bounces: number) => ({ sent, humanReplies, positives, bounces, meetingsRequested: 0 });
const rates = { action: 'metrics.rates', input: '', result: { scope: 'organization_metrics', last_7_days: period(40, 3, 1, 0), last_30_days: period(240, 7, 2, 4) } };
const channels = { action: 'metrics.channels', input: '', result: { email: { sent: 240, replies: 7, positives: 2, meetings: 0 }, linkedin: { sent: 12, replies: 3, positives: 0, meetings: 0 } } };
const batch = { action: 'campaigns.batch_report', input: 'c1', result: { campaign: { name: 'AXIS RR. HH.' }, summary: { recipients: 3, touches: 9, sent: 4, deferred: 4, failed: 1, uncertain: 0 } } };
const figures = (...values: string[]): CoworkBlock => ({ type: 'metrics', title: 'Cifras', period: 'Últimos 30 días', items: values.map((value, index) => ({ label: `Cifra ${index + 1}`, value, detail: null })) });
const table: CoworkBlock = { type: 'table', title: 'Contactos', columns: ['Nombre'], rows: [['Felipe']] };

test('a chart is drawn only from reads with something to draw, one per source', () => {
  const [week] = coworkChartCandidates([rates]);
  assert.equal(week.title, 'Correos enviados y lo que volvió');
  assert.deepEqual(week.labels, ['Enviados', 'Respuestas', 'Positivas', 'Rebotes']);
  assert.deepEqual(week.series, [{ name: 'Últimos 7 días', values: [40, 3, 1, 0] }, { name: 'Últimos 30 días', values: [240, 7, 2, 4] }]);
  assert.equal(week.period, 'Últimos 7 y 30 días');
  const [both, single] = coworkChartCandidates([channels, batch]);
  assert.deepEqual(both.series.map(series => `${series.name}:${series.values}`), ['Correo:240,7', 'LinkedIn:12,3']);
  assert.equal(single.title, 'Envíos de «AXIS RR. HH.»');
  assert.deepEqual(single.series, [{ name: '9 toques', values: [4, 4, 1, 0] }]);
  // Nothing sent, or a read that failed to say: nothing to draw.
  assert.deepEqual(coworkChartCandidates([{ ...rates, result: { last_7_days: period(0, 0, 0, 0), last_30_days: period(0, 0, 0, 0) } }]), []);
  assert.deepEqual(coworkChartCandidates([{ ...rates, result: { last_7_days: { sent: 4 }, last_30_days: period(9, 1, 0, 0) } }]), []);
  assert.deepEqual(coworkChartCandidates([{ ...channels, result: { email: { sent: 0, replies: 0 }, linkedin: { sent: 0, replies: 0 } } }]), []);
  assert.deepEqual(coworkChartCandidates([{ ...batch, result: { campaign: { name: 'x' }, summary: { touches: 0, sent: 0, deferred: 0, failed: 0, uncertain: 0 } } }]), []);
  assert.deepEqual(coworkChartCandidates([{ action: 'leads.search', input: '', result: { items: [] } }]), []);
  // The latest read of a source is the one drawn.
  const [latest] = coworkChartCandidates([rates, { ...rates, result: { last_7_days: period(10, 1, 0, 0), last_30_days: period(50, 2, 0, 0) } }]);
  assert.deepEqual(latest.series[1].values, [50, 2, 0, 0]);
});

test('the chart goes right after the figures card it is about, and never past the card limit', () => {
  const answer = { reply: 'Ok', blocks: [figures('240', '7'), table] };
  const shown = coworkWithCharts(answer, [rates]).blocks as CoworkBlock[];
  assert.deepEqual(shown.map(block => block.type), ['metrics', 'chart', 'table']);
  // Two sources: the chart whose figures the card repeats.
  const forBatch = coworkWithCharts({ blocks: [figures('9', '4', '1')] }, [rates, batch]).blocks as CoworkBlock[];
  assert.equal((forBatch[1] as Extract<CoworkBlock, { type: 'chart' }>).title, 'Envíos de «AXIS RR. HH.»');
  const forRates = coworkWithCharts({ blocks: [figures('240', '7', '2')] }, [batch, rates]).blocks as CoworkBlock[];
  assert.equal((forRates[1] as Extract<CoworkBlock, { type: 'chart' }>).title, 'Correos enviados y lo que volvió');
  const unrelated = { blocks: [figures('853', '901')] };
  assert.equal(coworkWithCharts(unrelated, [rates]), unrelated);
  // No figures card, no reads to draw, or no room: the answer is untouched.
  const plain = { reply: 'Ok', blocks: [table] };
  assert.equal(coworkWithCharts(plain, [rates]), plain);
  const noReads = { reply: 'Ok', blocks: [figures('1')] };
  assert.equal(coworkWithCharts(noReads, []), noReads);
  const full = { blocks: [figures('240'), table, table, table] };
  assert.equal(coworkWithCharts(full, [rates]), full);
});

test('a chart the model wrote is dropped, and its figures are not trusted', () => {
  const invented: CoworkBlock = { type: 'chart', title: 'Inventado', kind: 'line', period: null, unit: null, labels: ['a', 'b'], series: [{ name: 's', values: [1, 999] }] };
  const kept = coworkWithCharts({ reply: 'Ok', blocks: [figures('240'), invented] }, [rates]).blocks as CoworkBlock[];
  assert.deepEqual(kept.map(block => block.type), ['metrics', 'chart']);
  assert.notEqual((kept[1] as Extract<CoworkBlock, { type: 'chart' }>).title, 'Inventado');
  // Without reads to draw from, it just goes; an empty list reads as none, and «no blocks» stays as it was.
  assert.equal(coworkWithCharts({ blocks: [invented] }, []).blocks, null);
  assert.equal(coworkWithCharts({ blocks: null }, []).blocks, null);
  const untouched = { reply: 'Ok' };
  assert.equal(coworkWithCharts(untouched, [rates]), untouched);
});

test('a chart card reads as text, as a CSV and to a screen reader, and is sanitized to what it draws', () => {
  const chart = coworkChartCandidates([rates])[0];
  assert.equal(coworkBlockMeta(chart), 'Gráfico · Últimos 7 y 30 días');
  assert.equal(coworkBlocksText([chart]), ['Correos enviados y lo que volvió', 'Últimos 7 y 30 días', 'Últimos 7 días · Últimos 30 días',
    'Enviados: 40 · 240', 'Respuestas: 3 · 7', 'Positivas: 1 · 2', 'Rebotes: 0 · 4'].join('\n'));
  assert.equal(coworkChartCsv(chart), ['\ufeff"Correos enviados y lo que volvió (Últimos 7 y 30 días)","Últimos 7 días","Últimos 30 días"', '"Enviados","40","240"',
    '"Respuestas","3","7"', '"Positivas","1","2"', '"Rebotes","0","4"'].join('\r\n'));
  assert.match(coworkChartSummary(chart), /^Correos enviados y lo que volvió, Últimos 7 y 30 días\. 4 puntos y 2 series\. Últimos 7 días: mayor en Enviados \(40\); Últimos 30 días: mayor en Enviados \(240\)\.$/);
  assert.equal(coworkChartValue({ unit: '%' }, 12.5), '12,5 %');
  assert.equal(coworkChartValue({ unit: 'envíos' }, 240), '240 envíos');
  assert.equal(coworkChartValue({ unit: null }, 3), '3');
  // Sanitizing: a series with a value missing is dropped; with no series or fewer than two points the card goes.
  const messy = { ...chart, series: [{ name: 'ok', values: [1, 2, 3, 4] }, { name: 'corto', values: [1, 2] }, { name: 'raro', values: [1.23456, 2, 3, 4] }] };
  const [clean] = coworkBlocks([messy]) as Array<Extract<CoworkBlock, { type: 'chart' }>>;
  assert.deepEqual(clean.series.map(series => series.name), ['ok', 'raro']);
  assert.deepEqual(clean.series[1].values, [1.23, 2, 3, 4]);
  assert.deepEqual(coworkBlocks([{ ...chart, series: [{ name: 'corto', values: [1, 2] }] }]), []);
});

test('the answer of a turn that read the metrics comes with its chart', async () => {
  const base = { message: '¿Cómo voy?', signal: new AbortController().signal, authorize: async () => {}, record: async () => {} };
  const read = { action: 'metrics.rates' as const, query: null, leadId: null, answer: null };
  const answer = { action: 'answer' as const, query: null, leadId: null,
    answer: { reply: 'Enviaste 240 correos en 30 días y respondieron 7.', document: null, question: '¿Revisamos la campaña que menos responde?',
      suggestions: [{ label: 'Sí', message: 'Sí, revisa la campaña que menos responde' }], blocks: [figures('240', '7')] } };
  let step = 0;
  const result = await runCoworkReadLoop({ ...base, execute: async () => rates.result, decide: async () => (step++ === 0 ? read : answer) });
  assert.deepEqual((result as { blocks: CoworkBlock[] }).blocks.map(block => block.type), ['metrics', 'chart']);
  // The same turn with nothing sent has no chart to draw.
  step = 0;
  const empty = await runCoworkReadLoop({ ...base, execute: async () => ({ last_7_days: period(0, 0, 0, 0), last_30_days: period(0, 0, 0, 0) }),
    decide: async () => (step++ === 0 ? read : answer) });
  assert.deepEqual((empty as { blocks: CoworkBlock[] }).blocks.map(block => block.type), ['metrics']);
});

test('the chart card in the chat reads its largest value first', () => {
  const bar = { type: 'chart' as const, title: 'Contactos por etapa', kind: 'bar' as const, period: null, unit: null, labels: ['Nuevos', 'Reunión'], series: [{ name: 'Contactos', values: [8, 3] }] };
  assert.equal(coworkChartHeadline(bar), 'Mayor: Nuevos, 8 · 2 categorías');
  const line = { ...bar, kind: 'line' as const, unit: 'percent' as const, labels: ['Sem 1', 'Sem 2', 'Sem 3'], series: [{ name: 'Respuesta', values: [0.1, 0.25, 0.2] }, { name: 'Rebote', values: [0, 0, 0] }] };
  assert.match(coworkChartHeadline(line), /^Mayor: Sem 2, .+ \(Respuesta\) · 3 puntos$/);
});
