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
  const { localNow, ...clock } = context.clock;
  assert.deepEqual(clock, { serverNow: '2026-08-31T12:00:00.000Z', timezone: 'UTC', source: 'server', timeZone: 'America/Santiago' });
  // Chile is UTC-4 in August: the same instant reads 08:00 locally.
  assert.match(localNow, /31 de agosto de 2026/);
  assert.match(localNow, /08:00/);
  assert.equal(context.glossary.last_30_days, 'últimos 30 días');
  assert.equal(context.externalSearchCapability, instructions.externalSearchCapability);
  assert.equal(context.effectCapability, instructions.effectCapability);
  assert.equal(context.readBudget.remaining, 3);
  assert.deepEqual(context.contactReadGuidance.observedLeadIds, []);
  assert.match(instructions.systemPrompt, /no demuestra que el correo esté sincronizado/);
});

test('timestamps in results and history travel with their local reading, originals intact', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const context = coworkDecisionContext(instructions, {
    history: { turns: [{ at: '2026-09-25T13:08:00Z', reply: 'Listo.' }] }, request: 'Mis últimos contactos', mustAnswer: false, executionPolicy: {},
    observations: [{ action: 'leads.search', input: '', result: { items: [
      { name: 'Carlos', created_at: '2026-09-25T04:26:06Z' }, { name: 'Nehal', created_at: '2026-09-22T19:18:14.123+00:00', created_at_local: 'ya viene' },
    ], capturedAt: '2026-09-25', note: 'Revisado 2026-09-25T04:26:06Z' } }],
  }, new Date('2026-09-25T13:10:00Z'));
  const result = (context.observations[0] as { result: { items: Array<Record<string, string>>; capturedAtLocal?: string; noteLocal?: string } }).result;
  // Chile is UTC-3 in late September: 04:26Z is 01:26 the same day.
  assert.deepEqual(result.items[0], { name: 'Carlos', created_at: '2026-09-25T04:26:06Z', created_at_local: '25 sep 2026, 01:26' });
  assert.equal(result.items[1].created_at_local, 'ya viene');
  assert.equal(result.capturedAtLocal, undefined);
  assert.equal(result.noteLocal, undefined);
  assert.equal((context.history as { turns: Array<Record<string, string>> }).turns[0].atLocal, '25 sep 2026, 10:08');
  assert.equal(context.readBudget.remaining, 2);
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

test('assistant notes never consume the read budget and the time zone is configurable', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const context = coworkDecisionContext(instructions, {
    history: { turns: [] }, request: 'Hola', mustAnswer: false, executionPolicy: {},
    observations: [{ action: 'assistant.note', input: '', result: { reply: 'Propongo buscar su correo.' } }],
  }, new Date('2026-12-01T15:00:00Z'), 'America/Bogota');
  assert.equal(context.readBudget.remaining, 3);
  assert.equal(context.clock.timeZone, 'America/Bogota');
  assert.match(context.clock.localNow, /10:00/);
});
