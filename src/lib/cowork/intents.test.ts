import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkAgentInstructions } from './agent-instructions';
import { coworkIntentIncludes, coworkIntentPromptsEnabled, coworkIntentsOf, coworkTurnIntents } from './intents';

const sizeOf = (intents: ReturnType<typeof coworkTurnIntents>) => {
  const instructions = coworkAgentInstructions({ externalSearch: true, automaticExternalSearch: false, writer: true, prepareBatch: true, intents });
  return Object.values(instructions).filter((value): value is string => typeof value === 'string').reduce((sum, value) => sum + value.length, 0);
};
const sorted = (intents: Set<string> | null) => (intents ? [...intents].sort() : null);

test('each kind of request lands on its intent, without accents or case', () => {
  assert.ok(coworkIntentsOf('Hola, ¿qué puedes hacer?').has('help'));
  assert.ok(coworkIntentsOf('busca gerentes de operaciones de mineras en Antofagasta').has('search'));
  assert.ok(coworkIntentsOf('mejora este correo').has('email'));
  assert.ok(coworkIntentsOf('INVITA a Carlos por LinkedIn').has('linkedin'));
  assert.ok(coworkIntentsOf('¿cómo me ha ido esta semana?').has('metrics'));
  assert.ok(coworkIntentsOf('¿cuál es mi cliente ideal?').has('strategy'));
  assert.ok(coworkIntentsOf('¿qué licitaciones hay?').has('opportunities'));
  assert.ok(coworkIntentsOf('lee el Excel que subí').has('files'));
  assert.ok(coworkIntentsOf('¿qué tengo pendiente hoy?').has('agenda'));
  assert.ok(coworkIntentsOf('revisa mi dominio, me llegan a spam').has('domain'));
  assert.ok(coworkIntentsOf('¿cuántos créditos me quedan?').has('credits'));
});

test('an intent brings what its recipes lean on, and a greeting stays small', () => {
  assert.deepEqual(sorted(coworkTurnIntents('hola')), ['help']);
  assert.deepEqual(sorted(coworkTurnIntents('busca 20 gerentes de RR. HH. en retail')), ['contacts', 'search']);
  assert.ok(coworkTurnIntents('¿qué tengo pendiente hoy?')!.has('replies'));
});

test('nothing recognizable, or a request that touches almost everything, gets the whole prompt', () => {
  assert.equal(coworkTurnIntents('mmm'), null);
  assert.equal(coworkTurnIntents('hoy busca leads, guárdalos, escríbeles un correo y por LinkedIn, mide cómo me fue, revisa mi dominio, los créditos y las licitaciones del Excel'), null);
});

test('a short follow-up continues the previous request; a full request stands on its own', () => {
  const history = [{ request: 'busca gerentes de logística en Santiago' }];
  assert.ok(coworkTurnIntents('sí, dale', history)!.has('search'));
  assert.ok(!coworkTurnIntents('prepárame un informe de cómo me fue este mes con las cifras de envíos y respuestas', history)!.has('search'));
});

test('only the first line of a request counts: a pasted email does not widen it', () => {
  const pasted = 'mejora este correo:\nHola Marcela, te escribo por la reunión, el informe, la licitación y tus créditos de LinkedIn.';
  assert.ok(!coworkTurnIntents(pasted)!.has('opportunities'));
  assert.ok(coworkTurnIntents(pasted)!.has('email'));
});

test('the prompt of a greeting is well under half of the whole one, and the whole one is unchanged without intents', () => {
  const whole = sizeOf(null);
  assert.ok(sizeOf(coworkTurnIntents('hola')) < whole * 0.5, `${sizeOf(coworkTurnIntents('hola'))} of ${whole}`);
  assert.ok(sizeOf(coworkTurnIntents('mejora este correo')) < whole * 0.75);
  assert.equal(sizeOf(new Set(['help', 'search', 'contacts', 'email', 'linkedin', 'metrics', 'strategy', 'opportunities', 'files', 'agenda', 'replies', 'domain', 'credits', 'crm'] as const)), whole);
});

test('a part travels when one of its tags is in the turn; everything travels without intents', () => {
  assert.equal(coworkIntentIncludes(null, ['email']), true);
  assert.equal(coworkIntentIncludes(new Set(['email'] as const), ['email', 'linkedin']), true);
  assert.equal(coworkIntentIncludes(new Set(['metrics'] as const), ['email', 'linkedin']), false);
});

test('the recipes of a turn keep their rules: a search keeps how to propose it, a report keeps the report recipe', () => {
  const search = coworkAgentInstructions({ externalSearch: true, automaticExternalSearch: false, intents: coworkTurnIntents('busca gerentes de operaciones en minería') });
  assert.match(search.externalSearchCapability || '', /prospecting\.propose_search/);
  assert.doesNotMatch(search.systemPrompt, /«Informe para mi jefe/);
  const report = coworkAgentInstructions({ externalSearch: true, automaticExternalSearch: false, intents: coworkTurnIntents('hazme un informe para mi jefe') });
  assert.match(report.systemPrompt, /«Informe para mi jefe/);
  assert.equal(report.externalSearchCapability, null);
  // The core always goes: rule 4 and the output contract.
  for (const instructions of [search, report]) {
    assert.match(instructions.systemPrompt, /4\. Termina el trabajo; no lo devuelvas/);
    assert.match(instructions.systemPrompt, /Devuelve action, query, leadId, outline/);
  }
});

test('intent prompts are off unless turned on', () => {
  assert.equal(coworkIntentPromptsEnabled({}), false);
  assert.equal(coworkIntentPromptsEnabled({ COWORK_INTENT_PROMPTS_ENABLED: 'true' }), true);
});
