import assert from 'node:assert/strict';
import test from 'node:test';
import { draftFailureAdvice } from './draft-failure-advice';

const refused = (...codes: string[]) => ({ error: 'draft_preflight_failed', issues: codes.map(code => ({ code, message: 'texto interno para el modelo' })) });

test('the first refusal says why, once per cause, and lets the person try again', () => {
  const advice = draftFailureAdvice(refused('unsupported_material_claim', 'unsupported_material_claim', 'personalization_invalid'), 1)!;
  assert.equal(advice.title, 'No logré escribir un correo que se pueda respaldar');
  assert.deepEqual(advice.reasons, ['El correo se apoyaba en algo que la investigación de esta empresa no respalda.'], 'three issues, one cause');
  assert.match(advice.next, /una vez más/);
  assert.equal(advice.researchFirst, false);
});

test('two refusals in a row send the person to the research instead of to another try', () => {
  const advice = draftFailureAdvice(refused('unsupported_material_claim'), 2)!;
  assert.equal(advice.researchFirst, true);
  assert.match(advice.next, /Investiga de nuevo a este contacto/);
  assert.equal(draftFailureAdvice(refused('unsupported_material_claim'), 20)!.researchFirst, true);
});

test('at most two causes, and the internal messages for the model are never shown', () => {
  const advice = draftFailureAdvice(refused('unsupported_material_claim', 'tone_asunto', 'body_length', 'duplicate_content'), 1)!;
  assert.equal(advice.reasons.length, 2);
  assert.deepEqual(advice.reasons, ['El correo se apoyaba en algo que la investigación de esta empresa no respalda.', 'El texto no cumplía las reglas de tono y claridad.']);
  assert.ok(!JSON.stringify(advice).includes('texto interno'));
});

test('a refusal without a cause we can name still explains what to do', () => {
  assert.deepEqual(draftFailureAdvice({ error: 'draft_preflight_failed' }, 1)!.reasons, []);
  assert.deepEqual(draftFailureAdvice(refused('algo_nuevo'), 1)!.reasons, []);
});

test('a provider failure is not blamed on the research and never sends the person to it', () => {
  for (const error of ['openai_generation_failed', 'openai_rewrite_failed']) {
    const advice = draftFailureAdvice({ error }, 5)!;
    assert.equal(advice.researchFirst, false);
    assert.match(advice.next, /No es un problema de la investigación/);
  }
});

test('other answers keep the screen as it was', () => {
  assert.equal(draftFailureAdvice({ error: 'research_stale' }, 1), null);
  assert.equal(draftFailureAdvice({ error: 'evidence_insufficient' }, 3), null);
  assert.equal(draftFailureAdvice(null, 1), null);
  assert.equal(draftFailureAdvice(undefined, 1), null);
});
