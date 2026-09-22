import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionContext } from './decision-context';
import { coworkAgentInstructions } from './agent-instructions';

test('decision context uses server clock independently of historical dates', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const context = coworkDecisionContext(instructions, {
    history: { turns: [{ request: 'Hoy es 18 de agosto', clock: { serverNow: '2026-08-18' } }] },
    request: 'Revisa la fecha antes de calcular', observations: [], mustAnswer: false,
    executionPolicy: { mode: 'approval' },
  }, new Date('2026-08-31T12:00:00Z'));
  assert.deepEqual(context.clock, { serverNow: '2026-08-31T12:00:00.000Z', timezone: 'UTC', source: 'server' });
  assert.equal(context.externalSearchCapability, instructions.externalSearchCapability);
  assert.equal(context.effectCapability, instructions.effectCapability);
  assert.equal(context.readBudget.remaining, 3);
  assert.deepEqual(context.contactReadGuidance.observedLeadIds, []);
  assert.match(instructions.systemPrompt, /no demuestra que el correo esté sincronizado/);
});

test('contact hints use lead identity rather than send-row identity and count reads', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const id = '00000000-0000-4000-8000-000000000001';
  const context = coworkDecisionContext(instructions, {
    history: { turns: [] }, request: 'Revisa pendientes', mustAnswer: false, executionPolicy: {},
    observations: [{ action: 'contacted.search', result: { items: [
      { id: 'send-row', lead_id: id }, { lead_id: id }, { lead_id: 'invalid' },
    ] } }, { action: 'specialists.review', result: {} }],
  });
  assert.deepEqual(context.contactReadGuidance.observedLeadIds, [id]);
  assert.equal(context.readBudget.remaining, 2);
});
