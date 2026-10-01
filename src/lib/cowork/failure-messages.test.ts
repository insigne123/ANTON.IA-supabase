import assert from 'node:assert/strict';
import test from 'node:test';
import { CoworkDecisionRejected } from './agent-loop';
import { coworkFailureCategory, coworkFailureMessage } from './failure-messages';

test('a proposal the server refused explains the reason in plain words', () => {
  const error = new CoworkDecisionRejected('x', 'La propuesta no se pudo preparar: El destinatario nicogun123@gmail.com ya no está disponible para esta audiencia.', true);
  assert.equal(coworkFailureMessage(error), 'No pude preparar la acción: El destinatario nicogun123@gmail.com ya no está disponible para esta audiencia.');
  assert.equal(coworkFailureCategory(error), 'proposal_rejected');
});

test('internal refusals and unknown errors never leak their details', () => {
  const internal = new CoworkDecisionRejected('Missing tool argument', 'Falta el argumento de la consulta (query, leadId…)');
  assert.doesNotMatch(coworkFailureMessage(internal), /query|leadId|argumento/);
  const unknown = new Error('relation "public.cowork_x" does not exist');
  assert.doesNotMatch(coworkFailureMessage(unknown), /relation|cowork_x/);
  assert.equal(coworkFailureCategory(unknown), 'unknown');
});

test('known operational causes say what to do next', () => {
  assert.match(coworkFailureMessage(new Error('Daily search quota exhausted')), /búsquedas externas de hoy/);
  assert.match(coworkFailureMessage(new Error('Thread effect budget exhausted')), /Escríbeme para seguir: retomo en esta misma conversación/);
  assert.match(coworkFailureMessage(new Error('OPENAI_HTTP_429:{"error":"rate"}')), /saturado/);
  const timeout = new Error('Structured generation timed out.'); timeout.name = 'TimeoutError';
  assert.match(coworkFailureMessage(timeout), /tardó demasiado/);
  const auth = Object.assign(new Error('Acceso Cowork revocado.'), { name: 'AuthError', status: 403 });
  assert.equal(coworkFailureCategory(auth), 'access');
});

test('a long conversation never tells the person to open a new work; each cap says what to do (1 oct)', () => {
  const daily = new Error('COWORK_DAILY_MODEL_BUDGET: No se pudo reservar presupuesto para continuar este trabajo.');
  assert.equal(coworkFailureCategory(daily), 'model_budget_daily');
  assert.match(coworkFailureMessage(daily), /uso diario del asistente\. Se renueva a medianoche, hora de Chile/);
  const turn = new Error('No se pudo reservar presupuesto para continuar este trabajo.');
  assert.equal(coworkFailureCategory(turn), 'model_budget');
  assert.match(coworkFailureMessage(turn), /Escríbeme «sigue» y continúo desde aquí, en esta misma conversación/);
  assert.equal(coworkFailureCategory(new Error('COWORK_CONVERSATION_MODEL_BUDGET: No se pudo reservar presupuesto para continuar este trabajo.')),
    'model_budget_conversation');
  for (const error of [turn, daily, new Error('Thread effect budget exhausted'), new Error('Thread search budget exhausted')]) {
    assert.doesNotMatch(coworkFailureMessage(error), /trabajo nuevo|alcanzó su límite/);
  }
});
