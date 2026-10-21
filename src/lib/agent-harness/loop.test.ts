import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { danglingToolCalls, estimateTokens, clearOldToolResults, summarizeOldTurns, tailStart } from './context';
import { runAgent, type AgentHooks } from './loop';
import { call, reply, ScriptedModel, usageOf } from './scripted';
import { defineTool, ToolRegistry } from './tools';
import type { AgentEvent, ContentBlock, Message, ToolResultBlock } from './types';

const signal = () => new AbortController().signal;
const ask = (text: string): Message[] => [{ role: 'user', content: text }];
const results = (message: Message) => (message.content as ContentBlock[]).filter((block): block is ToolResultBlock => block.type === 'tool_result');

const lookup = defineTool({
  name: 'consultar', description: 'Consulta un dato', kind: 'read', schema: z.object({ clave: z.string().min(1) }),
  run: async ({ clave }) => ({ status: 'ok', output: { clave, valor: clave.toUpperCase() } }),
});
const answer = defineTool({
  name: 'responder', description: 'Entrega la respuesta', kind: 'meta', schema: z.object({ reply: z.string().min(1) }),
  run: async ({ reply: text }) => ({ status: 'final', output: { reply: text }, text }),
});

test('the model asks for a tool, reads its result and closes in text', async () => {
  const model = new ScriptedModel([reply([call('consultar', { clave: 'abc' }, 't1')]), reply('El valor es ABC.')]);
  const run = await runAgent({ model, system: 'sys', messages: ask('dame abc'), registry: new ToolRegistry([lookup]), limits: { maxRounds: 4 }, signal: signal() });
  assert.equal(run.stopReason, 'end_turn');
  assert.equal(run.text, 'El valor es ABC.');
  assert.equal(run.rounds, 2);
  assert.equal(run.toolCalls, 1);
  assert.deepEqual(run.usage, { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 });
  // The second call saw the result of the first.
  const seen = results(model.requests[1].messages[2]);
  assert.equal(seen[0].tool_use_id, 't1');
  assert.match(String(seen[0].content), /ABC/);
});

test('tools asked together run together and answer in the order asked', async () => {
  const slow = (name: string, ms: number) => defineTool({ name, description: name, kind: 'read', schema: z.object({}),
    run: async () => { await new Promise(resolve => setTimeout(resolve, ms)); return { status: 'ok', output: name }; } });
  const model = new ScriptedModel([reply([call('a', {}, 'ta'), call('b', {}, 'tb'), call('c', {}, 'tc')]), reply('listo')]);
  const started = Date.now();
  const run = await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([slow('a', 60), slow('b', 60), slow('c', 60)]), limits: { maxRounds: 3 }, signal: signal() });
  assert.ok(Date.now() - started < 150, 'three reads of 60 ms went one after another');
  assert.deepEqual(results(model.requests[1].messages[2]).map(block => block.tool_use_id), ['ta', 'tb', 'tc']);
  assert.equal(run.toolCalls, 3);
});

test('what changes something runs one at a time after the reads, and the policy can answer instead of it', async () => {
  const order: string[] = [];
  const read = defineTool({ name: 'leer', description: 'leer', kind: 'read', schema: z.object({}), run: async () => { order.push('leer'); return { status: 'ok', output: 1 }; } });
  const send = defineTool({ name: 'enviar', description: 'enviar', kind: 'effect', schema: z.object({ a: z.string() }), run: async ({ a }) => { order.push(`enviar:${a}`); return { status: 'ok', output: 'ok' }; } });
  const hooks: AgentHooks = { beforeTool: async ({ tool, input }) => (tool.name === 'enviar' && (input as { a: string }).a === 'no'
    ? { status: 'error', message: 'Necesita aprobación de la persona.' } : undefined) };
  const model = new ScriptedModel([reply([call('enviar', { a: 'si' }, 'e1'), call('leer', {}, 'l1'), call('enviar', { a: 'no' }, 'e2')]), reply('hecho')]);
  await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([read, send]), limits: { maxRounds: 3 }, signal: signal(), hooks });
  assert.deepEqual(order, ['leer', 'enviar:si']);
  const seen = results(model.requests[1].messages[2]);
  assert.deepEqual(seen.map(block => block.tool_use_id), ['e1', 'l1', 'e2']);
  assert.equal(seen[2].is_error, true);
  assert.match(String(seen[2].content), /aprobación/);
});

test('an input that does not fit, an unknown tool and a tool that throws come back as results to fix', async () => {
  const broken = defineTool({ name: 'roto', description: 'roto', kind: 'read', schema: z.object({}), run: async () => { throw new Error('el proveedor no respondió'); } });
  const model = new ScriptedModel([
    reply([call('consultar', { clave: '' }, 'a'), call('fantasma', {}, 'b'), call('roto', {}, 'c')]),
    reply([call('consultar', { clave: 'ok' }, 'd')]),
    reply('fin'),
  ]);
  const run = await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([lookup, broken]), limits: { maxRounds: 4 }, signal: signal() });
  const first = results(model.requests[1].messages[2]);
  assert.equal(first.length, 3);
  assert.ok(first.every(block => block.is_error));
  assert.match(String(first[0].content), /clave/);
  assert.match(String(first[1].content), /No existe la herramienta fantasma/);
  assert.match(String(first[2].content), /el proveedor no respondió/);
  assert.equal(run.text, 'fin');
});

test('an access error ends the run instead of reaching the model', async () => {
  const guarded = defineTool({ name: 'g', description: 'g', kind: 'read', schema: z.object({}), run: async () => { throw Object.assign(new Error('No autorizado'), { name: 'AuthError', status: 403 }); } });
  const model = new ScriptedModel([reply([call('g', {})]), reply('no debería llegar')]);
  await assert.rejects(runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([guarded]), limits: { maxRounds: 3 }, signal: signal() }), /No autorizado/);
  assert.equal(model.calls, 1);
});

test('the final tool ends the run with its value, after the reads asked with it', async () => {
  const model = new ScriptedModel([reply([call('consultar', { clave: 'x' }, 'r'), call('responder', { reply: 'Listo.' }, 'f')])]);
  const run = await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([lookup, answer]), finalTool: 'responder', limits: { maxRounds: 3 }, signal: signal() });
  assert.equal(run.stopReason, 'final_tool');
  assert.deepEqual(run.output, { reply: 'Listo.' });
  assert.equal(run.toolCalls, 2);
  // The conversation ends with the results of that round, so it can be continued.
  assert.equal(run.messages.at(-1)?.role, 'user');
});

test('a reviewer holds the answer back once, the model fixes it, and the second one is accepted', async () => {
  let seen = 0;
  const hooks: AgentHooks = { review: async info => { seen += 1; return seen === 1 ? `Falta la cifra (${info.via}).` : null; } };
  const model = new ScriptedModel([reply([call('responder', { reply: 'Sin cifra' }, 'f1')]), reply([call('responder', { reply: 'Con cifra: 42' }, 'f2')])]);
  const events: AgentEvent[] = [];
  const run = await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([answer]), finalTool: 'responder', limits: { maxRounds: 4 }, signal: signal(), hooks, maxReviews: 2, onEvent: event => events.push(event) });
  assert.deepEqual(run.output, { reply: 'Con cifra: 42' });
  const held = results(model.requests[1].messages[2])[0];
  assert.equal(held.is_error, true);
  assert.match(String(held.content), /Falta la cifra \(final_tool\)/);
  assert.deepEqual(events.filter(event => event.type === 'review').map(event => (event as { feedback: string | null }).feedback), ['Falta la cifra (final_tool).', null]);
});

test('a review never sends the answer back more often than allowed, nor on the last round', async () => {
  const hooks: AgentHooks = { review: async () => 'Siempre hay algo.' };
  const model = new ScriptedModel([reply('uno'), reply('dos'), reply('tres')]);
  const run = await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([]), limits: { maxRounds: 5 }, signal: signal(), hooks, maxReviews: 1 });
  assert.equal(run.text, 'dos');
  assert.equal(model.calls, 2);
  const last = new ScriptedModel([reply('a medias')]);
  const single = await runAgent({ model: last, system: 's', messages: ask('x'), registry: new ToolRegistry([]), limits: { maxRounds: 1 }, signal: signal(), hooks });
  assert.equal(single.text, 'a medias');
});

test('on the last round the model can only deliver the answer', async () => {
  const model = new ScriptedModel([reply([call('consultar', { clave: 'a' })]), reply([call('responder', { reply: 'Con lo que tengo.' })])]);
  const run = await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([lookup, answer]), finalTool: 'responder', limits: { maxRounds: 2 }, signal: signal() });
  assert.equal(run.stopReason, 'final_tool');
  assert.deepEqual(model.requests[0].toolChoice, undefined);
  assert.deepEqual(model.requests[1].toolChoice, { type: 'tool', name: 'responder' });
  assert.deepEqual(model.requests[1].tools.map(tool => tool.name), ['responder']);
});

test('the tool budget and the deadline each bring the last round forward', async () => {
  const budget = new ScriptedModel([reply([call('consultar', { clave: 'a' }), call('consultar', { clave: 'b' })]), reply([call('responder', { reply: 'Basta.' })])]);
  await runAgent({ model: budget, system: 's', messages: ask('x'), registry: new ToolRegistry([lookup, answer]), finalTool: 'responder', limits: { maxRounds: 6, maxToolCalls: 2 }, signal: signal() });
  assert.deepEqual(budget.requests[1].toolChoice, { type: 'tool', name: 'responder' });

  let clock = 0;
  const slow = new ScriptedModel([() => { clock += 60_000; return reply([call('consultar', { clave: 'a' })]); }, reply([call('responder', { reply: 'Tarde.' })])]);
  const run = await runAgent({ model: slow, system: 's', messages: ask('x'), registry: new ToolRegistry([lookup, answer]), finalTool: 'responder', limits: { maxRounds: 6, deadlineMs: 50_000 }, signal: signal(), now: () => clock });
  assert.equal(run.rounds, 2);
  assert.deepEqual(slow.requests[1].toolChoice, { type: 'tool', name: 'responder' });
});

test('a tool call cut by the output limit is answered with the problem, not run', async () => {
  const ran: string[] = [];
  const tool = defineTool({ name: 't', description: 't', kind: 'read', schema: z.object({ x: z.string() }), run: async ({ x }) => { ran.push(x); return { status: 'ok', output: x }; } });
  const model = new ScriptedModel([reply([call('t', { x: 'a medias' }, 'c')], 'max_tokens'), reply('ok')]);
  await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([tool]), limits: { maxRounds: 3 }, signal: signal() });
  assert.deepEqual(ran, []);
  assert.match(String(results(model.requests[1].messages[2])[0].content), /se cortó/);
});

test('a cancelled run stops before the next call', async () => {
  const controller = new AbortController();
  const stopper = defineTool({ name: 's', description: 's', kind: 'read', schema: z.object({}), run: async () => { controller.abort(new DOMException('cancelado', 'AbortError')); return { status: 'ok', output: 1 }; } });
  const model = new ScriptedModel([reply([call('s', {})]), reply('nunca')]);
  await assert.rejects(runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([stopper]), limits: { maxRounds: 3 }, signal: controller.signal }));
  assert.equal(model.calls, 1);
});

test('the hooks see every call: reserve before, record after', async () => {
  const log: string[] = [];
  const hooks: AgentHooks = {
    beforeModelCall: async ({ round }) => { log.push(`reserva ${round}`); },
    afterModelCall: async ({ round, response }) => { log.push(`registro ${round} ${response.usage.outputTokens}`); },
    afterTool: async ({ tool }) => { log.push(`tool ${tool.name}`); },
  };
  const model = new ScriptedModel([reply([call('consultar', { clave: 'a' })], undefined, usageOf(10, 7)), reply('fin', undefined, usageOf(10, 3))]);
  await runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([lookup]), limits: { maxRounds: 3 }, signal: signal(), hooks });
  assert.deepEqual(log, ['reserva 1', 'registro 1 7', 'tool consultar', 'reserva 2', 'registro 2 3']);
});

test('a refused request fails the run with a name the product can read', async () => {
  const model = new ScriptedModel([reply('no puedo', 'refusal')]);
  await assert.rejects(runAgent({ model, system: 's', messages: ask('x'), registry: new ToolRegistry([]), limits: { maxRounds: 2 }, signal: signal() }), /AGENT_REFUSAL/);
});

// ─── Tools that are found, not carried ─────────────────────────────────────────────────────────────────────────────────────

test('a deferred tool is not offered until the model searches for it, then it stays loaded', async () => {
  const metrics = defineTool({ name: 'metricas.tasas', description: 'Tasas de apertura y respuesta de campañas', tags: ['campañas', 'métricas'], kind: 'read', deferred: true,
    schema: z.object({}), run: async () => ({ status: 'ok', output: { apertura: 0.4 } }) });
  const crm = defineTool({ name: 'crm.buscar', description: 'Busca contactos en el CRM', tags: ['contactos'], kind: 'read', deferred: true, schema: z.object({}), run: async () => ({ status: 'ok', output: [] }) });
  const registry = new ToolRegistry([lookup, metrics, crm]);
  const model = new ScriptedModel([
    reply([call('metricas.tasas', {}, 'early')]),
    reply([call('buscar_herramientas', { query: 'tasas campañas' }, 'find')]),
    reply([call('metricas.tasas', {}, 'now')]),
    reply('40% de apertura.'),
  ]);
  const run = await runAgent({ model, system: 's', messages: ask('cómo van mis campañas'), registry, limits: { maxRounds: 6 }, signal: signal() });
  assert.deepEqual(model.requests[0].tools.map(tool => tool.name), ['consultar', 'buscar_herramientas']);
  assert.match(String(results(model.requests[1].messages[2])[0].content), /aún no está cargada/);
  assert.match(String(results(model.requests[2].messages[4])[0].content), /metricas\.tasas/);
  assert.deepEqual(model.requests[2].tools.map(tool => tool.name), ['consultar', 'buscar_herramientas', 'metricas.tasas']);
  assert.equal(run.text, '40% de apertura.');
  assert.equal(registry.isLoaded('crm.buscar'), false);
});

// ─── Context ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

function longConversation(exchanges: number, size = 3_000): Message[] {
  const messages: Message[] = [{ role: 'user', content: 'pedido original' }];
  for (let index = 0; index < exchanges; index++) {
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `u${index}`, name: 'consultar', input: { clave: `k${index}` } }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `u${index}`, content: `dato ${index} `.repeat(size / 8) }] });
  }
  return messages;
}

test('old tool results are cleared and the recent ones stay whole, with every call still answered', () => {
  const messages = longConversation(10);
  const { messages: cleared, cleared: count } = clearOldToolResults(messages, 3);
  assert.equal(count, 7);
  assert.match(String(results(cleared[2])[0].content), /Resultado omitido.*consultar\(\{"clave":"k0"\}\)/);
  assert.match(String(results(cleared[20])[0].content), /dato 9/);
  assert.deepEqual(danglingToolCalls(cleared), []);
  assert.ok(estimateTokens(cleared) < estimateTokens(messages) / 2);
  // Clearing again changes nothing.
  assert.equal(clearOldToolResults(cleared, 3).cleared, 0);
});

test('the summary replaces the middle, keeps the request and the recent turns, and starts the tail on the assistant', async () => {
  const messages = longConversation(10);
  const result = await summarizeOldTurns(messages, 6, async transcript => {
    assert.match(transcript, /consultar\(\{"clave":"k0"\}\)/);
    return 'Se consultaron k0..k6; ninguna tiene cifras.';
  });
  assert.ok(result);
  assert.equal(result.messages[0].role, 'user');
  const first = result.messages[0].content as ContentBlock[];
  assert.equal(first.length, 2);
  assert.match((first[1] as { text: string }).text, /Resumen de lo hecho[\s\S]*k0\.\.k6/);
  assert.equal(result.messages[1].role, 'assistant');
  assert.deepEqual(danglingToolCalls(result.messages), []);
  assert.equal(tailStart(messages, 6) % 2, 1);
});

test('a long run makes room for itself: clears first, then summarizes, and reports it', async () => {
  const calls: string[] = [];
  const tool = defineTool({ name: 'consultar', description: 'c', kind: 'read', schema: z.object({ clave: z.string() }), run: async ({ clave }) => ({ status: 'ok', output: 'x'.repeat(30_000), text: `${clave} ${'dato '.repeat(6_000)}` }) });
  const steps = Array.from({ length: 8 }, (_, index) => reply([call('consultar', { clave: `k${index}` })]));
  const model = new ScriptedModel([...steps, reply('terminé')]);
  const events: AgentEvent[] = [];
  const run = await runAgent({
    model, system: 's', messages: ask('investiga'), registry: new ToolRegistry([tool]), limits: { maxRounds: 12 }, signal: signal(),
    compaction: { clearAt: 12_000, summarizeAt: 15_000, keepResults: 2, keepMessages: 4, summarize: async transcript => { calls.push(transcript); return 'Resumen: se leyeron k0 a k5.'; } },
    onEvent: event => events.push(event),
  });
  assert.equal(run.text, 'terminé');
  const methods = events.filter(event => event.type === 'compact').map(event => (event as { method: string }).method);
  assert.ok(methods.includes('clear'));
  assert.ok(methods.includes('summary'));
  assert.ok(calls.length >= 1);
  for (const request of model.requests) assert.deepEqual(danglingToolCalls(request.messages), []);
  // The last request is far smaller than the sum of everything read.
  assert.ok(estimateTokens(model.requests.at(-1)!.messages) < 8 * 6_000 * 5 / 3.2 / 2);
});
