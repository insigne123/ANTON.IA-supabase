// «¿Cuál es mi ICP?» (scripts/fixtures/cowork-icp-corpus.ts) played through the real loop with a scripted model: a good turn reads
// the analysis and the profile, explains and delivers «Tu cliente ideal»; answering without reading, or reading and saying nothing,
// must not pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { ICP_ANALYSIS, ICP_CORPUS } from './fixtures/cowork-icp-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const entry = ICP_CORPUS.find(item => item.id === 'icp-cual-es-mi-icp')!;
const parallel = coworkDecisionSchema.parse({ action: 'reads.parallel', query: null, leadId: null, answer: null,
  reads: [{ action: 'icp.analyze', input: '' }, { action: 'profile.get', input: '' }] });
const answer = (reply: string, document: { title: string; content: string } | null, question: string) => coworkDecisionSchema.parse({
  action: 'answer', query: null, leadId: null, answer: { reply, document, question, suggestions: [{ label: 'Sí, guárdalo', message: 'Guarda mi cliente ideal en Perfil' }] } });

const REPLY = [
  'Tu cliente ideal hoy son las jefaturas y gerencias de RR. HH. de empresas que contratan en volumen, como seguridad privada y retail: de ahí salieron tus 2 respuestas positivas.',
  '',
  'Revisé tus envíos registrados: 64 personas contactadas desde agosto, 4 respuestas y 2 positivas, ambas de áreas de personas. Operaciones, finanzas y gerencia general no respondieron con interés.',
  '',
  'Ojo con la muestra: con 34 personas de RR. HH. contactadas, es una pista para probar, no una conclusión. Por eso te propongo probar dos segmentos de 30 contactos cada uno durante tres semanas y medir las respuestas positivas.',
  '',
  'En «Perfil» aún no están los cargos ni las industrias de tu cliente ideal; si los guardas, la búsqueda y los correos parten de ahí.',
].join('\n');
const DOCUMENT = { title: 'Tu cliente ideal', content: [
  'Resumen: las respuestas positivas vienen de RR. HH. en seguridad privada y retail; la muestra es chica.',
  '## Quién te compra y por qué', 'Jefaturas y gerencias de RR. HH. que revisan antecedentes de muchos postulantes.',
  '## Qué empresas', 'Seguridad privada y retail que contratan en volumen.',
  '## A quién no', 'Finanzas y gerencia general de empresas pequeñas.',
  '## Qué dicen tus resultados', '| Área | Personas | Positivas |\n|---|---|---|\n| Personas y RR. HH. | 34 | 2 |\n| Operaciones y logística | 12 | 0 |',
  '## Hipótesis y cómo probarlas', 'Dos segmentos de 30 contactos, tres semanas, medidos en respuestas positivas.',
  '## Próximos pasos', 'Guardar el cliente ideal en Perfil y preparar el primer segmento.',
].join('\n\n') };

const IDEAL: CorpusDecider = async context => context.observations.length === 0 ? parallel
  : answer(REPLY, DOCUMENT, '¿Guardo estos cargos e industrias como tu cliente ideal en Perfil?');
const failing = async (decide: CorpusDecider) => (await runCorpusCase(entry, decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the analysis in the world is the one the app computes: 64 people, 2 positive, a small sample', () => {
  assert.equal(ICP_ANALYSIS.totals.people, 64);
  assert.equal(ICP_ANALYSIS.totals.positive, 2);
  assert.equal(ICP_ANALYSIS.segments.area.groups[0].value, 'Personas y RR. HH.');
  assert.equal(ICP_ANALYSIS.segments.area.groups[0].confidence, 'indicio');
  assert.equal(ICP_ANALYSIS.coverage, null);
});

test('a good turn reads the analysis and the profile, explains and delivers «Tu cliente ideal»', async () => {
  const outcome = await runCorpusCase(entry, IDEAL);
  const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
  assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
  assert.deepEqual(outcome.result.actions, ['icp.analyze', 'profile.get']);
});

test('answering without reading fails at least three checks', async () => {
  const missed = await failing(async () => answer('Tu cliente ideal son empresas medianas.', null, '¿Seguimos?'));
  assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
});

test('reading and saying nothing fails at least three checks', async () => {
  const missed = await failing(async context => context.observations.length === 0 ? parallel : answer('Revisé tus datos y hay cosas por ver.', null, '¿Seguimos?'));
  assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
});

test('claiming that a small group «works better» is caught', async () => {
  const missed = await failing(async context => context.observations.length === 0 ? parallel
    : answer(`${REPLY}\n\nRR. HH. funciona mejor que operaciones.`, DOCUMENT, '¿Guardo estos cargos e industrias como tu cliente ideal en Perfil?'));
  assert.deepEqual(missed, ['no afirma que un grupo «funciona mejor» o «convierte mejor»']);
});
