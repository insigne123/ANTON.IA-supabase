import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionContext } from './decision-context';
import { coworkAgentInstructions } from './agent-instructions';
import { COWORK_TURN_DEFAULTS } from './turn-budget';

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
  assert.equal(context.readBudget.remaining, COWORK_TURN_DEFAULTS.reads);
  // The first consulting decision draws the plan; later ones are told it is on screen.
  assert.equal('planStatus' in context, false);
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
  assert.match(String((context as { planStatus?: string }).planStatus), /outline es null/);
  const result = (context.observations[0] as { result: { items: Array<Record<string, string>>; capturedAtLocal?: string; noteLocal?: string } }).result;
  // Chile is UTC-3 in late September: 04:26Z is 01:26 the same day.
  assert.deepEqual(result.items[0], { name: 'Carlos', created_at: '2026-09-25T04:26:06Z', created_at_local: '25 sep 2026, 01:26' });
  assert.equal(result.items[1].created_at_local, 'ya viene');
  assert.equal(result.capturedAtLocal, undefined);
  assert.equal(result.noteLocal, undefined);
  assert.equal((context.history as { turns: Array<Record<string, string>> }).turns[0].atLocal, '25 sep 2026, 10:08');
  assert.equal(context.readBudget.remaining, COWORK_TURN_DEFAULTS.reads - 1);
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
  assert.equal(context.readBudget.remaining, COWORK_TURN_DEFAULTS.reads - 1);
});

test('assistant notes never consume the read budget and the time zone is configurable', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const context = coworkDecisionContext(instructions, {
    history: { turns: [] }, request: 'Hola', mustAnswer: false, executionPolicy: {},
    observations: [{ action: 'assistant.note', input: '', result: { reply: 'Propongo buscar su correo.' } }],
  }, new Date('2026-12-01T15:00:00Z'), 'America/Bogota');
  assert.equal(context.readBudget.remaining, COWORK_TURN_DEFAULTS.reads);
  assert.equal(context.clock.timeZone, 'America/Bogota');
  assert.match(context.clock.localNow, /10:00/);
});

test('the user context travels with its instruction and stays null when the server could not read it', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const base = { history: { turns: [] }, request: 'Escríbele a Marcela', observations: [], mustAnswer: false, executionPolicy: {} };
  const userContext = { fullName: 'Nicolás Y.', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl',
    offer: 'AXIS: consultas judiciales automáticas', offerSource: 'organization' as const };
  const context = coworkDecisionContext(instructions, { ...base, userContext });
  assert.deepEqual({ ...context.userContext, instruction: undefined }, { ...userContext, instruction: undefined });
  assert.match(context.userContext?.instruction || '', /firma con fullName/);
  // Reading it spends nothing from the reads of the turn.
  assert.equal(context.readBudget.remaining, COWORK_TURN_DEFAULTS.reads);
  assert.equal(coworkDecisionContext(instructions, base).userContext, null);
  assert.equal(coworkDecisionContext(instructions, { ...base, userContext: null }).userContext, null);
  assert.match(instructions.systemPrompt, /userContext trae quién es el usuario/);
});

test('what «Perfil» adds (services, proof points, sector) travels with the user context', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const base = { history: { turns: [] }, request: '¿Qué puedes hacer?', observations: [], mustAnswer: false, executionPolicy: {} };
  const userContext = { fullName: 'Nicolás Y.', jobTitle: 'Gerente Comercial', companyName: 'Yago SpA', companyDomain: 'yago.cl',
    offer: 'AXIS consulta el PJUD por lote.', offerSource: 'profile' as const, services: ['AXIS'], proofPoints: ['1.000 personas en 30 minutos'], sector: 'Software' };
  const context = coworkDecisionContext(instructions, { ...base, userContext });
  assert.deepEqual({ ...context.userContext, instruction: undefined }, { ...userContext, instruction: undefined });
  assert.match(context.userContext?.instruction || '', /proofPoints son resultados que el usuario cargó en su perfil/);
  assert.match(instructions.systemPrompt, /nunca escribas «no veo», «no tienes» ni «no hay»/);
  assert.match(instructions.systemPrompt, /puede guardarla en Perfil/);
});

test('the coordinator reads what the loop has left of the turn, and a batch spends all of it', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const base = { history: { turns: [] }, request: 'Revisa mis contactos', observations: [], mustAnswer: false, executionPolicy: {} };
  const context = coworkDecisionContext(instructions, { ...base, turnBudget: { reads: 6, readsLeft: 4, decisionsLeft: 3 } });
  assert.deepEqual({ ...context.readBudget, instruction: undefined }, { maximum: 6, remaining: 4, instruction: undefined });
  // The budget travels once, inside readBudget.
  assert.equal('turnBudget' in context, false);
  const batch = coworkDecisionContext(instructions, { ...base, observations: [{ action: 'lists.review_batch', input: '[]', result: {} }] });
  assert.equal(batch.readBudget.remaining, 0);
  // The rules name the same numbers the loop enforces, and read as before with the default ceiling.
  const raised = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false, turnCeiling: { decisions: 5, reads: 6, softDeadlineMs: 50000 } });
  assert.match(raised.systemPrompt, /Planifica las 6 lecturas/);
  assert.match(raised.parallelReadCapability, /Máximo TOTAL de 6 lecturas por ejecución/);
  assert.match(instructions.systemPrompt, /Planifica las 3 lecturas/);
  assert.match(instructions.parallelReadCapability, /Máximo TOTAL de 3 lecturas por ejecución/);
});

test('with the Writer on, the coordinator reads how to hand it the emails, and that it may not on its last decision', () => {
  const base = { history: { turns: [] }, request: 'Armame una secuencia', observations: [], mustAnswer: false, executionPolicy: { mode: 'approval' } };
  const off = coworkDecisionContext(coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false }), base);
  assert.equal('writerCapability' in off, false);
  assert.equal('writerAvailable' in off, false);
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false, writer: true });
  assert.match(String(instructions.writerCapability), /draft\.write/);
  const budget = (decisionsLeft: number) => ({ reads: 3, readsLeft: 3, decisionsLeft });
  const early = coworkDecisionContext(instructions, { ...base, turnBudget: budget(2) });
  assert.equal(early.writerCapability, instructions.writerCapability);
  assert.equal(early.writerAvailable, true);
  assert.equal(coworkDecisionContext(instructions, { ...base, mustAnswer: true, turnBudget: budget(0) }).writerAvailable, false);
});

test('approved memories travel with the user context and say how to use them; without them nothing changes', () => {
  const instructions = coworkAgentInstructions({ externalSearch: false, automaticExternalSearch: false });
  const base = { history: { turns: [], olderTurnsOmitted: false }, request: 'escribe un correo', observations: [], mustAnswer: false, executionPolicy: { mode: 'approval' as const } };
  const person = { fullName: 'Nicolás Y.', jobTitle: null, companyName: 'Yago SpA', companyDomain: null, offer: 'AXIS', offerSource: 'profile' as const };
  const plain = coworkDecisionContext(instructions, { ...base, userContext: person });
  assert.doesNotMatch(plain.userContext?.instruction || '', /memories/);
  const remembered = coworkDecisionContext(instructions, { ...base, userContext: { ...person, memories: ['tono: tuteo, cercano y breve'] } });
  assert.deepEqual(remembered.userContext?.memories, ['tono: tuteo, cercano y breve']);
  assert.match(remembered.userContext?.instruction || '', /memories son cosas que el usuario aprobó que ANTON\.IA recuerde/);
  assert.match(remembered.userContext?.instruction || '', /salvo que el pedido de ahora diga otra cosa/);
  // The recipe for the home's «Cuéntame qué vendes» card.
  assert.match(instructions.systemPrompt, /«Guarda en mi perfil lo que vendo: …»[^']*profile\.update con valueProposition/);
});
