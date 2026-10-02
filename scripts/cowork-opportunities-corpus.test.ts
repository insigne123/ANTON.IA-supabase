// «¿Qué oportunidades hay hoy?» (scripts/fixtures/cowork-opportunities-corpus.ts) played through the real loop with a scripted model:
// a good turn reads «Oportunidades», explains and shows the best ones with their signal; answering without reading must not pass;
// and for an account that does not see the section the read is refused and the instructions do not name it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { OPPORTUNITIES_CORPUS, OPPORTUNITIES_READ } from './fixtures/cowork-opportunities-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const entry = OPPORTUNITIES_CORPUS.find(item => item.id === 'oportunidades-hoy')!;
const read = coworkDecisionSchema.parse({ action: 'opportunities.list', query: '', leadId: null, answer: null,
  outline: [{ label: 'Reviso tus oportunidades de hoy', read: 'opportunities.list' }, { label: 'Te digo cuál mirar primero', read: null }] });
const answer = (reply: string, question: string, blocks: unknown[] = []) => coworkDecisionSchema.parse({
  action: 'answer', query: null, leadId: null, answer: { reply, document: null, question, blocks,
    suggestions: [{ label: 'Sí, búscalos', message: 'Busca a los decisores de RR. HH. y Operaciones de Retail Andes' }] } });

const REPLY = [
  'La oportunidad para mirar primero es Retail Andes: está contratando fuerte y aún no es contacto tuyo.',
  '',
  'Revisé la búsqueda de hoy en Google for Jobs, Compra Ágil y Mercado Público, la de LinkedIn de ayer y el archivo del SEIA que subiste el 15 de septiembre. Hay 2 empresas contratando, 2 licitaciones abiertas y 1 proyecto.',
  '',
  'Retail Andes publicó 14 avisos de empleo en los últimos 30 días (6 de operario de bodega y 4 de reponedor), el último el 24 de septiembre, según LinkedIn y Laborum: es justo el personal que ofreces. Logística Sur también contrata, con 9 avisos, y ahí ya tienes contactos.',
  '',
  'En licitaciones, la Compra Ágil del Hospital Regional de Antofagasta por personal transitorio para bodega cierra en 3 días; conviene revisar sus bases hoy.',
  '',
  'Te propongo buscar a los decisores de RR. HH. y Operaciones de Retail Andes: la búsqueda usa créditos y nada sale sin tu aprobación. Marcarla como «Me interesa» se hace en la página Oportunidades.',
].join('\n');
const TABLE = { type: 'table', title: 'Oportunidades de hoy', columns: ['Tipo', 'Empresa o comprador', 'Por qué calza', 'Señal'], rows: [
  ['Contratando', 'Retail Andes', 'Operarios, reponedores y cajeros en la RM', '14 avisos en 30 días, según LinkedIn'],
  ['Contratando', 'Logística Sur', 'Conductores y bodegueros; ya tienes contactos', '9 avisos en 30 días'],
  ['Compra Ágil', 'Hospital Regional de Antofagasta', 'Personal transitorio para bodega', 'Cierra en 3 días'],
  ['Proyecto SEIA', 'Aguas del Norte S.A.', 'US$ 320 millones, en calificación', 'Presentado el 3 de marzo'],
] };

const IDEAL: CorpusDecider = async context => context.observations.length === 0 ? read
  : answer(REPLY, '¿Busco a los decisores de Retail Andes?', [TABLE]);
const failing = async (decide: CorpusDecider, overrides: Partial<typeof entry> = {}) =>
  (await runCorpusCase({ ...entry, ...overrides }, decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the world is what the app computes: the dismissed company stays out, every item has its signal', () => {
  const summary = OPPORTUNITIES_READ('');
  assert.deepEqual(summary.hiring.map(item => item.company), ['Retail Andes', 'Logística Sur']);
  assert.equal(summary.counts.hiring.dismissed, 1);
  assert.match(summary.hiring[0].signal, /^Retail Andes publicó 14 avisos de empleo en los últimos 30 días \(6 de Operario de bodega y 4 de Reponedor\), el último el 24 sept 2026, según LinkedIn y Laborum\.$/);
  assert.equal(summary.tenders[0].kind, 'Compra Ágil');
  assert.equal(summary.counts.tenders.closingIn7Days, 1);
  assert.deepEqual(summary.gaps, []);
});

test('a good turn reads the opportunities, explains and shows the best ones with their signal', async () => {
  const outcome = await runCorpusCase(entry, IDEAL);
  const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
  assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
  assert.deepEqual(outcome.result.actions, ['opportunities.list']);
});

test('answering without reading fails at least three checks', async () => {
  const missed = await failing(async () => answer('Hay varias oportunidades interesantes esta semana.', '¿Seguimos?'));
  assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
});

test('recommending the dismissed company is caught', async () => {
  const missed = await failing(async context => context.observations.length === 0 ? read
    : answer(`${REPLY}\n\nSeguridad Austral también contrata guardias.`, '¿Busco a los decisores de Retail Andes?', [TABLE]));
  assert.deepEqual(missed, ['no recomienda a la empresa descartada']);
});

test('an account that does not see «Oportunidades»: the read is refused and the instructions do not name it', async () => {
  const seen: string[] = [];
  const outcome = await runCorpusCase({ ...entry, opportunities: false }, async context => {
    const refused = (context as { rejectedDecisions?: Array<{ action: string; reason: string }> }).rejectedDecisions;
    if (refused?.length) seen.push(...refused.map(item => item.reason));
    return context.observations.length === 0 && !refused?.length ? read : answer('No tengo esa información; puedo revisar tus contactos sin contactar.', '¿Los reviso?');
  });
  assert.deepEqual(outcome.result.actions, [], 'nothing was read');
  assert.ok(seen.some(reason => /no está disponible/.test(reason)), seen.join(' | '));
  const options = { turnCeiling: undefined, externalSearch: true, automaticExternalSearch: false };
  assert.doesNotMatch(coworkAgentInstructions(options).systemPrompt, /opportunities\.list/);
  assert.match(coworkAgentInstructions({ ...options, opportunities: true }).systemPrompt, /opportunities\.list/);
});
