import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { call, reply, ScriptedModel, usageOf } from '@/lib/agent-harness/scripted';
import { COWORK_NOTE_ACTION, COWORK_PLAN_ACTION } from './contracts';
import { coworkHarnessSettings, type CoworkHarnessConfig } from './harness-config';
import { COWORK_HARNESS_PROTOCOL, coworkHarnessTelemetry, coworkReadShape, coworkToolName, runCoworkHarnessTurn } from './harness-turn';
import type { CoworkLoopInput, CoworkObservation } from './agent-loop';

const UUID = '00000000-0000-4000-8000-000000000021';
const RUN = '00000000-0000-4000-8000-000000000010';
const capabilities = [
  { name: 'leads.search', description: 'Busca contactos guardados', input: z.string().max(200) },
  { name: 'campaigns.list', description: 'Lista campañas', input: z.literal('') },
  { name: 'research.get_existing', description: 'Investigación de un contacto', input: z.string().uuid() },
  { name: 'privacy.contactability_batch', description: 'Restricciones de varios contactos', input: z.string().max(400) },
  { name: 'opportunities.list', description: 'Oportunidades', input: z.string().max(200) },
];

function harness(model: ScriptedModel, overrides: Partial<CoworkHarnessConfig> = {}): CoworkHarnessConfig {
  return { model, system: 'REGLAS DEL COORDINADOR', context: '{"request":"hola"}', capabilities, maxRounds: 5, maxReads: 6, deadlineMs: 60_000, ...overrides };
}

function base(model: ScriptedModel, extra: Partial<CoworkLoopInput> = {}, config: Partial<CoworkHarnessConfig> = {}) {
  const executed: Array<{ action: string; value: string }> = [];
  const recorded: unknown[] = [];
  const authorized = { count: 0 };
  const input = {
    message: 'Qué contactos tengo', runId: RUN, signal: new AbortController().signal,
    authorize: async () => { authorized.count += 1; },
    execute: async (action: string, value: string) => { executed.push({ action, value }); return action === 'campaigns.list' ? { campaigns: [] } : { items: [{ id: UUID, name: 'José C.', company: 'GrupoExpro' }], scope: 'own_saved_contacts' }; },
    record: async (observation: unknown) => { recorded.push(observation); },
    decide: async () => { throw new Error('the coordinator loop must not run'); },
    harness: harness(model, config),
    ...extra,
  } as unknown as CoworkLoopInput;
  return { input, executed, recorded, authorized };
}

const answer = (text: string) => call('responder', { reply: text, document: null });

test('reads are tools of the gateway, asked together run together, and the turn ends with the answer', async () => {
  const model = new ScriptedModel([
    reply([call('leads_search', { consulta: 'Logística' }), call('campaigns_list', {})]),
    reply([answer('Tienes 1 contacto y ninguna campaña.')]),
  ]);
  const { input, executed, recorded } = base(model);
  const result = await runCoworkHarnessTurn(input);
  assert.equal(result.reply, 'Tienes 1 contacto y ninguna campaña.');
  assert.deepEqual(executed.map(item => `${item.action}:${item.value}`).sort(), ['campaigns.list:', 'leads.search:Logística']);
  assert.equal(recorded.length, 2);
  const tools = model.requests[0].tools.map(tool => tool.name);
  assert.ok(['leads_search', 'campaigns_list', 'research_get_existing', 'privacy_contactability_batch', 'actualizar_plan', 'responder'].every(name => tools.includes(name)));
  assert.equal(tools.includes('opportunities_list'), false, 'a read the account does not have is not offered');
  assert.equal(tools.some(name => name.startsWith('proponer_')), false, 'no proposals without a way to stage them');
  assert.ok(model.requests[0].system.startsWith(COWORK_HARNESS_PROTOCOL));
  assert.match(model.requests[0].system, /REGLAS DEL COORDINADOR/);
  assert.equal(model.requests[0].messages[0].content, '{"request":"hola"}');
  assert.equal(model.requests[0].effort, undefined);
  assert.equal(model.calls, 2);
});

test('each read takes the input its capability takes: nothing, an id, a list of ids or free text', async () => {
  assert.deepEqual(capabilities.map(coworkReadShape), ['text', 'none', 'id', 'leadIds', 'text']);
  assert.equal(coworkToolName('campaign.stop_v2'), 'campaign_stop_v2');
  const model = new ScriptedModel([
    reply([call('research_get_existing', { id: UUID }), call('privacy_contactability_batch', { leadIds: [UUID] })]),
    reply([answer('Listo.')]),
  ]);
  const { input, executed } = base(model);
  await runCoworkHarnessTurn(input);
  assert.deepEqual(executed.map(item => `${item.action}:${item.value}`).sort(), [`privacy.contactability_batch:["${UUID}"]`, `research.get_existing:${UUID}`]);
});

test('a read asked twice, even at the same time, is made once; past the budget the model is told to answer', async () => {
  const model = new ScriptedModel([
    reply([call('leads_search', { consulta: 'a' }, 'x1'), call('leads_search', { consulta: 'a' }, 'x2'), call('campaigns_list', {}, 'x3')]),
    reply([answer('Con lo que hay.')]),
  ]);
  const { input, executed } = base(model, {}, { maxReads: 1 });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(result.reply, 'Con lo que hay.');
  assert.deepEqual(executed.map(item => item.action), ['leads.search']);
  const seen = (model.requests[1].messages[2].content as Array<{ tool_use_id: string; content: string }>);
  assert.match(seen[1].content, /Ya lo consultaste/);
  assert.match(seen[2].content, /Se acabó el presupuesto de consultas/);
});

test('the plan is recorded once, and an answer in prose still ends the turn', async () => {
  const plan = { pasos: [{ paso: 'Reviso tus contactos', estado: 'en_curso' }, { paso: 'Te resumo', estado: 'pendiente' }] };
  const model = new ScriptedModel([reply([call('actualizar_plan', plan)]), reply([call('actualizar_plan', plan)]), reply('Tienes 3 contactos.')]);
  const { input, recorded } = base(model);
  const result = await runCoworkHarnessTurn(input);
  assert.equal(result.reply, 'Tienes 3 contactos.');
  assert.deepEqual(recorded, [{ action: COWORK_PLAN_ACTION, input: '', result: { steps: [{ label: 'Reviso tus contactos', read: null }, { label: 'Te resumo', read: null }] } }]);
});

test('the answer leaves through the same polish as ever, and its memory goes to remember', async () => {
  const memory = { offer: 'Revisión de antecedentes', audience: 'Jefes de RR. HH.', people: [], decisions: [], pending: [] };
  const remembered: unknown[] = [];
  const model = new ScriptedModel([reply([call('responder', { reply: 'Listo.', document: null, memoria: memory })])]);
  const { input } = base(model, { remember: async value => { remembered.push(value); } });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(result.reply, 'Listo.');
  assert.deepEqual(remembered, [memory]);
  assert.equal('memoria' in result, false);
});

test('a proposal is staged through the coordinator checks: an observed target reaches the approval card', async () => {
  const proposals: Array<{ kind: string; targetId: string; label: string; originRunId: string }> = [];
  const model = new ScriptedModel([
    reply([call('leads_search', { consulta: 'José' })]),
    reply([call('proponer_contactos', { action: 'lead.enrich', leadId: UUID, explicacion: 'Busco el correo de José C. (1 crédito). Revisa y aprueba.' })]),
  ]);
  const { input } = base(model, { proposeEffect: async proposal => { proposals.push(proposal as never); } });
  const result = await runCoworkHarnessTurn(input);
  assert.deepEqual(proposals, [{ kind: 'enrich_contact', targetId: UUID, label: 'Buscar los datos de José C. (GrupoExpro)', originRunId: RUN }]);
  assert.equal(result.reply, 'Busco el correo de José C. (1 crédito). Revisa y aprueba.');
  assert.equal(model.calls, 2, 'a proposal ends the turn: nothing is asked after it');
  assert.ok(model.requests[0].tools.some(tool => tool.name === 'proponer_contactos'));
});

test('a proposal on something nobody read comes back as the problem to fix, and the turn goes on', async () => {
  const proposals: unknown[] = [];
  const model = new ScriptedModel([
    reply([call('proponer_contactos', { action: 'lead.enrich', leadId: UUID, explicacion: 'Busco su correo.' }, 'p1')]),
    reply([call('leads_search', { consulta: 'José' })]),
    reply([call('proponer_contactos', { action: 'lead.enrich', leadId: UUID, explicacion: 'Busco su correo.' }, 'p2')]),
  ]);
  const { input } = base(model, { proposeEffect: async proposal => { proposals.push(proposal); } });
  await runCoworkHarnessTurn(input);
  const problem = model.requests[1].messages[2].content as Array<{ is_error?: boolean; content: string }>;
  assert.equal(problem[0].is_error, true);
  assert.match(problem[0].content, /no aparece en los resultados de este hilo/);
  assert.equal(proposals.length, 1);
});

test('a note and an external search are proposed only when the worker can take them', async () => {
  const withBoth = new ScriptedModel([reply([answer('ok')])]);
  await runCoworkHarnessTurn(base(withBoth, { proposeEffect: async () => {}, proposeSearch: async () => {}, proposeNote: async () => {} }).input);
  const names = withBoth.requests[0].tools.map(tool => tool.name);
  assert.deepEqual(names.filter(name => name.startsWith('proponer_')).sort(), ['proponer_ajustes', 'proponer_busqueda', 'proponer_campana', 'proponer_contactos', 'proponer_crm', 'proponer_linkedin', 'proponer_nota']);
  const searches: unknown[] = [];
  const model = new ScriptedModel([reply([call('proponer_busqueda', { action: 'prospecting.propose_search', explicacion: 'Busco 25 personas de logística en Santiago.',
    searchCriteria: { target: 'people', titles: ['Gerente de Operaciones'], locations: ['Santiago, Chile'], industries: ['Logística'], limit: 25 } })])]);
  const { input } = base(model, { proposeSearch: async criteria => { searches.push(criteria); }, message: 'Busca gerentes de operaciones de logística en Santiago' });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(searches.length, 1);
  assert.match(result.reply, /Busco 25 personas/);
});

test('the judge can send the answer back once, and the one that stands is the corrected one', async () => {
  let reviews = 0;
  const corrected = { onCorrection: [] as unknown[] };
  const model = new ScriptedModel([
    reply([call('leads_search', { consulta: '' })]),
    reply([call('responder', { reply: 'Tienes algunos contactos.', document: null })]),
    reply([call('responder', { reply: 'Tienes 1 contacto: José C. de GrupoExpro.', document: null })]),
  ]);
  const { input } = base(model, {
    judge: async () => { reviews += 1; return reviews === 1 ? 'Di cuántos contactos y cuáles.' : null; },
    onCorrection: verdict => { corrected.onCorrection.push(verdict); },
  });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(reviews, 1);
  assert.equal(result.reply, 'Tienes 1 contacto: José C. de GrupoExpro.');
  assert.equal(corrected.onCorrection.length, 1);
  const held = model.requests[2].messages[4].content as Array<{ is_error?: boolean; content: string }>;
  assert.equal(held[0].is_error, true);
  assert.match(held[0].content, /Di cuántos contactos y cuáles/);
});

test('the Writer is a tool: its emails are the answer, or the base of a campaign when one was asked', async () => {
  const model = new ScriptedModel([reply([call('redactar', { kind: 'email', recipients: ['José C.'], objective: 'Presentar la oferta', angle: 'Temporada alta', tone: 'cercano', steps: null, campaign: false, notes: null, findings: null })])]);
  const writes: unknown[] = [];
  const { input } = base(model, {
    write: async brief => { writes.push(brief); return { reply: 'Aquí está el correo para José.', document: null, blocks: [{ type: 'email_draft', title: 'Para José', to: ['José C.'], subject: 'Temporada alta', body: 'Hola José,\n\nTe escribo por la temporada alta.\n\nSaludos' }] } as never; },
  });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(writes.length, 1);
  assert.equal(result.reply, 'Aquí está el correo para José.');
  assert.equal(model.calls, 1);
});

test('the Analyst needs something read first', async () => {
  const model = new ScriptedModel([
    reply([call('analizar', { question: '¿Qué campaña rinde más?', focus: 'respuestas', notes: null }, 'a1')]),
    reply([call('campaigns_list', {})]),
    reply([call('analizar', { question: '¿Qué campaña rinde más?', focus: 'respuestas', notes: null }, 'a2')]),
  ]);
  const { input } = base(model, { analyze: async () => ({ reply: 'La campaña A rinde más.', document: null }) });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(result.reply, 'La campaña A rinde más.');
  const first = model.requests[1].messages[2].content as Array<{ is_error?: boolean; content: string }>;
  assert.equal(first[0].is_error, true);
  assert.match(first[0].content, /primero consulta los datos/);
});

test('every model call is authorized and reserved first, and its cost is recorded after', async () => {
  const log: string[] = [];
  const model = new ScriptedModel([reply([call('campaigns_list', {})], undefined, usageOf(500, 40)), reply([answer('Sin campañas.')], undefined, usageOf(700, 60))]);
  const { input, authorized } = base(model, {}, {
    reserve: async () => { log.push('reserva'); return `r${log.length}`; },
    recordUsage: async (reservation, response, ms) => { log.push(`registro ${reservation} ${response.usage.outputTokens} ${typeof ms}`); },
  });
  await runCoworkHarnessTurn(input);
  assert.deepEqual(log, ['reserva', 'registro r1 40 number', 'reserva', 'registro r3 60 number']);
  assert.ok(authorized.count >= 4);
  assert.deepEqual(coworkHarnessTelemetry({ content: [], stopReason: 'end_turn', model: 'claude-sonnet-5-5', usage: { inputTokens: 1_000, outputTokens: 80, cacheReadTokens: 800, cacheWriteTokens: 100 } }, 1200), {
    modelName: 'claude-sonnet-5-5', durationMs: 1200,
    usage: { prompt_tokens: 1_000, completion_tokens: 80, total_tokens: 1_080, prompt_tokens_details: { cached_tokens: 800 }, cache_creation_input_tokens: 100 },
  });
});

test('a turn that resumes from specialists or answers a question about a proposal keeps the coordinator loop', async () => {
  const model = new ScriptedModel([reply([answer('no debería llamarse')])]);
  const decisions: string[] = [];
  const { input } = base(model, {
    clarification: true,
    decide: async () => { decisions.push('v1'); return { action: 'answer', query: null, leadId: null, answer: { reply: 'Aclaración.', document: null } } as never; },
  });
  const result = await runCoworkHarnessTurn(input);
  assert.equal(result.reply, 'Aclaración.');
  assert.ok(decisions.length >= 1);
  assert.equal(model.calls, 0);
  const resumed = new ScriptedModel([reply([answer('no debería llamarse')])]);
  const { input: second } = base(resumed, { resumedObservations: [{ action: 'leads.search', input: '', result: {} } as CoworkObservation],
    decide: async () => ({ action: 'answer', query: null, leadId: null, answer: { reply: 'Síntesis.', document: null } }) as never });
  assert.equal((await runCoworkHarnessTurn(second)).reply, 'Síntesis.');
  assert.equal(resumed.calls, 0);
});

test('a run that ends without an answer fails the turn like the coordinator loop does, and the note action stays out of the tools', async () => {
  const model = new ScriptedModel([reply([call('campaigns_list', {})]), reply([call('campaigns_list', {})]), reply([call('campaigns_list', {})])]);
  const { input } = base(model, {}, { maxRounds: 2 });
  await assert.rejects(runCoworkHarnessTurn(input), /did not produce a final answer/);
  assert.equal(COWORK_NOTE_ACTION, 'assistant.note');
});

test('the settings are off unless COWORK_RUNTIME=harness, default to a Claude, and stay inside what the ledger admits', () => {
  assert.equal(coworkHarnessSettings({}), null);
  assert.equal(coworkHarnessSettings({ COWORK_RUNTIME: 'openai' }), null);
  assert.deepEqual(coworkHarnessSettings({ COWORK_RUNTIME: 'harness' }), { model: 'claude-sonnet-5-5', effort: 'medium', maxRounds: 5, maxReads: 6 });
  assert.deepEqual(coworkHarnessSettings({ COWORK_RUNTIME: 'harness', COWORK_HARNESS_MODEL: 'claude-haiku-5-5', COWORK_HARNESS_EFFORT: 'high', COWORK_HARNESS_MAX_ROUNDS: '9', COWORK_HARNESS_MAX_READS: '0' }),
    { model: 'claude-haiku-5-5', effort: 'high', maxRounds: 5, maxReads: 1 });
  assert.equal(coworkHarnessSettings({ COWORK_RUNTIME: 'harness', COWORK_HARNESS_EFFORT: 'enorme' })?.effort, 'medium');
});
