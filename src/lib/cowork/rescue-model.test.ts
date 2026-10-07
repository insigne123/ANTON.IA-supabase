import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkRescueModel } from './rescue-model';
import { coworkRescueNote, coworkTurnFailure, CoworkDecisionRejected } from './agent-loop';

test('the rescue model is the one configured, and never astra', () => {
  assert.equal(coworkRescueModel({}), null, 'unset: no rescue');
  assert.equal(coworkRescueModel({ COWORK_RESCUE_MODEL: '  ' }), null);
  assert.equal(coworkRescueModel({ COWORK_RESCUE_MODEL: 'gpt-6.1-sol' }), 'gpt-6.1-sol');
  assert.equal(coworkRescueModel({ COWORK_RESCUE_MODEL: 'gpt-6-astra' }), null, 'the owner never wants astra used');
});

test('which failures a rescue may answer', () => {
  assert.equal(coworkTurnFailure(new Error('Cowork tool budget exhausted')), 'reads_at_last_decision');
  assert.equal(coworkTurnFailure(new Error('Cowork did not produce a final answer')), 'no_answer');
  assert.equal(coworkTurnFailure(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), 'model_unavailable');
  assert.equal(coworkTurnFailure(new Error('OPENAI_HTTP_503: unavailable')), 'model_unavailable');
  assert.equal(coworkTurnFailure(new CoworkDecisionRejected('x', 'corrígelo')), 'rejected_at_last_decision');
  assert.equal(coworkTurnFailure(Object.assign(new Error('invalid'), { issues: [{ path: ['answer'], message: 'Required' }] })), 'invalid_at_last_decision');
  assert.equal(coworkTurnFailure(new Error('leads read failed')), 'unexpected');
  for (const error of [new CoworkDecisionRejected('x', 'No pude preparar la acción: …', true), Object.assign(new Error('x'), { name: 'AbortError' }),
    Object.assign(new Error('x'), { status: 403 }), new Error('Cowork run is no longer writable'), new Error('Daily search quota exhausted'), 'texto']) {
    assert.equal(coworkTurnFailure(error), null);
  }
  assert.match(coworkRescueNote('reads_at_last_decision'), /^Este turno no alcanzó a terminar \(se acabaron las decisiones/);
  assert.match(coworkRescueNote('model_unavailable'), /No propongas acciones ni pidas más lecturas/);
});
