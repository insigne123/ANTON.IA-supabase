import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCoworkModeAvailable, coworkExecutionPolicy, coworkRequestApprovesEffect } from './execution-policy';

test('autonomy is disabled by server policy and never grants note writes', () => {
  assert.throws(() => assertCoworkModeAvailable('autonomous', false), /UNAVAILABLE/);
  assert.equal(coworkExecutionPolicy('autonomous', false).automaticExternalSearch, false);
  assert.equal(coworkExecutionPolicy('approval', true).automaticExternalSearch, false);
  const policy = coworkExecutionPolicy('autonomous', true);
  assert.equal(policy.automaticExternalSearch, true);
  assert.equal(policy.maxExternalSearchesPerRun, 1);
  assert.equal(policy.maxExternalResults, 25);
  assert.equal(policy.noteRequiresApproval, true);
});

test('the person\'s own words approve a research, and only an order or a yes to the offer', () => {
  const offer = 'Cristian Heyden ya está en tus contactos.\n\n¿Investigo a Cristian Heyden para preparar su correo?';
  // 6 Nov 2026: this message got a second question instead of the research.
  assert.equal(coworkRequestApprovesEffect('start_research', 'Sí, investiga a Cristian Heyden de Emporio Alemán antes de escribirle'), true);
  assert.equal(coworkRequestApprovesEffect('start_research', 'investígalo'), true);
  assert.equal(coworkRequestApprovesEffect('start_research', 'Investiga a los 3 de la lista'), true);
  assert.equal(coworkRequestApprovesEffect('start_research', 'dale', offer), true, 'a yes to «¿Investigo a…?»');
  assert.equal(coworkRequestApprovesEffect('start_research', 'sí', offer), true);
  assert.equal(coworkRequestApprovesEffect('start_research', 'dale', 'Listo.\n\n¿Te preparo el correo?'), false, 'a yes to something else');
  assert.equal(coworkRequestApprovesEffect('start_research', '¿lo investigo?'), false, 'a question asks');
  assert.equal(coworkRequestApprovesEffect('start_research', 'no lo investigues todavía'), false);
  assert.equal(coworkRequestApprovesEffect('start_research', 'si te parece, investígalo'), false, 'a condition waits for the card');
  assert.equal(coworkRequestApprovesEffect('start_research', 'mejor espera, investiga después'), false);
  assert.equal(coworkRequestApprovesEffect('send_email', 'investiga y envíale el correo'), false, 'only the effects listed');
  assert.equal(coworkRequestApprovesEffect('enrich_contact', 'investígalo'), false);
});
