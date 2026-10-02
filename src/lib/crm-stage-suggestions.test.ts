import assert from 'node:assert/strict';
import test from 'node:test';

import { describeStageMove, isStageSuggestionDecision, stageDecisionNotice, stageLabel, stageSuggestionReason } from '@/lib/crm-stage-suggestions';

test('each event explains its suggestion in plain words; unknown events fall back to their note', () => {
  assert.equal(stageSuggestionReason('delivered', 'Correo entregado correctamente'), 'Se entregó el correo.');
  assert.equal(stageSuggestionReason('meeting_request'), 'Pidió una reunión.');
  assert.equal(stageSuggestionReason('suplia_crm_update_stage'), 'SUPL.IA propone este cambio.');
  assert.equal(stageSuggestionReason('something_new', '  Nota   del evento '), 'Nota del evento');
  assert.equal(stageSuggestionReason(null, null), 'Se registró un evento de contacto.');
});

test('stages read with the pipeline names', () => {
  assert.equal(stageLabel('engaged'), 'Interesado');
  assert.equal(stageLabel(null), 'Nuevos');
  assert.equal(describeStageMove({ from_stage: null, to_stage: 'contacted' }), 'Nuevos → Contactado');
  assert.equal(describeStageMove({ from_stage: 'meeting', to_stage: 'closed_lost' }), 'Reunión → Perdido');
});

test('only accept and dismiss are decisions', () => {
  assert.ok(isStageSuggestionDecision('accept'));
  assert.ok(isStageSuggestionDecision('dismiss'));
  for (const value of ['ACCEPT', 'yes', '', null, 1]) assert.equal(isStageSuggestionDecision(value), false);
});

test('what the page says after deciding', () => {
  assert.equal(stageDecisionNotice({ accepted: 3, dismissed: 0, superseded: 0 }), '3 etapas actualizadas.');
  assert.equal(stageDecisionNotice({ accepted: 1, dismissed: 0, superseded: 1 }), '1 etapa actualizada · 1 ya estaba más avanzada y no se movió.');
  assert.equal(stageDecisionNotice({ dismissed: 2 }), '2 sugerencias descartadas.');
  assert.equal(stageDecisionNotice({}), 'No había sugerencias pendientes.');
});
