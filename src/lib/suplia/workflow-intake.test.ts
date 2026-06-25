import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeProspectingIntake, buildProspectingClarificationReply, shouldUseProfileAssumptions } from './workflow-intake';

test('asks for clarification on vague lead requests', () => {
  const intake = analyzeProspectingIntake('quiero buscar nuevos leads');
  assert.equal(intake.needsClarification, true);
  assert.ok(intake.missingFields.includes('tipo de empresa o segmento objetivo'));
  assert.ok(buildProspectingClarificationReply('quiero buscar nuevos leads').includes('necesito acotar'));
});

test('allows concrete prospecting requests to move into planning', () => {
  const intake = analyzeProspectingIntake('busca 10 leads de constructoras en Chile para vender mi software a gerentes de operaciones');
  assert.equal(intake.needsClarification, false);
});

test('detects profile assumption shortcut', () => {
  assert.equal(shouldUseProfileAssumptions('asume con mi perfil'), true);
  assert.equal(shouldUseProfileAssumptions('busca leads'), false);
});
