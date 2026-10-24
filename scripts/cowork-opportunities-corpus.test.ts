// «¿Qué licitaciones hay hoy?» (scripts/fixtures/cowork-opportunities-corpus.ts) played through the real loop with a scripted model.
// Cowork does not work «Oportunidades» (owner's decision, 24 oct 2026): it points to the section, with its link when the person can
// open it, and an answer that reads something or invents tenders does not pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkAgentInstructions } from '../src/lib/cowork/agent-instructions';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { coworkTurnIntents } from '../src/lib/cowork/intents';
import { OPPORTUNITIES_CORPUS } from './fixtures/cowork-opportunities-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const withSection = OPPORTUNITIES_CORPUS.find(item => item.id === 'oportunidades-a-la-seccion')!;
const withoutSection = OPPORTUNITIES_CORPUS.find(item => item.id === 'oportunidades-sin-seccion')!;
const answer = (reply: string, question: string) => coworkDecisionSchema.parse({
  action: 'answer', query: null, leadId: null, answer: { reply, document: null, question, blocks: [],
    suggestions: [{ label: 'Buscar decisores', message: 'Busca gerentes de operaciones de mineras en Antofagasta' }] } });
const failing = async (entry: typeof withSection, decide: CorpusDecider) =>
  (await runCorpusCase(entry, decide)).checks.filter(check => !check.passed).map(check => check.label);

const REDIRECT = 'Las licitaciones y la Compra Ágil se trabajan en la sección Oportunidades, que tiene su propio asistente y un chat en cada oportunidad: [Abrir Oportunidades](/opportunities).';
const ELSEWHERE = 'Cowork no trabaja licitaciones ni Compra Ágil. Lo que sí puedo hacer es buscar a quién escribir, preparar correos y seguir tus campañas.';

test('with the section: one sentence and its link, without reading anything', async () => {
  const outcome = await runCorpusCase(withSection, async () => answer(REDIRECT, '¿Busco a quién escribirle en las mineras de Antofagasta?'));
  const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
  assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
  assert.deepEqual(outcome.result.actions, []);
});

test('an invented tender, or no link, does not pass', async () => {
  const invented = await failing(withSection, async () => answer(`${REDIRECT}\n\nHoy está la licitación 1057-88-LE26 de la Municipalidad de Calama, cierra el viernes.`, '¿Te ayudo con algo más?'));
  assert.deepEqual(invented, ['no inventa licitaciones, cierres ni montos']);
  const noLink = await failing(withSection, async () => answer('Eso se ve en la sección Oportunidades.', '¿Te ayudo con algo más?'));
  assert.deepEqual(noLink, ['ofrece el enlace a la sección']);
});

test('without the section: no link it cannot open, and what Cowork does instead', async () => {
  assert.deepEqual(await failing(withoutSection, async () => answer(ELSEWHERE, '¿Busco a quién escribirle esta semana?')), []);
  assert.deepEqual(await failing(withoutSection, async () => answer(REDIRECT, '¿Te ayudo con algo más?')), ['no ofrece un enlace que no puede abrir']);
});

test('the instructions: no read of «Oportunidades» exists, and the link goes only to who can open it', () => {
  const options = { turnCeiling: undefined, externalSearch: true, automaticExternalSearch: false };
  for (const opportunitiesSection of [false, true]) {
    const prompt = coworkAgentInstructions({ ...options, opportunitiesSection }).systemPrompt;
    assert.doesNotMatch(prompt, /opportunities\.list|artifact\.opportunities/);
    assert.match(prompt, /no (?:se trabajan en|trabaja licitaciones)/);
    assert.equal(prompt.includes('[Abrir Oportunidades](/opportunities)'), opportunitiesSection);
  }
  // With intent prompts, the sentence travels with the turns that ask for it.
  const tenders = coworkAgentInstructions({ ...options, opportunitiesSection: true, intents: coworkTurnIntents('¿qué licitaciones hay hoy?') }).systemPrompt;
  assert.match(tenders, /Abrir Oportunidades/);
  const greeting = coworkAgentInstructions({ ...options, opportunitiesSection: true, intents: coworkTurnIntents('hola') }).systemPrompt;
  assert.doesNotMatch(greeting, /Abrir Oportunidades/);
});
