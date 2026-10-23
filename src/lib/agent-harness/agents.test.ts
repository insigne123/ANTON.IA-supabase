import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { anthropicModel, anthropicRequest, anthropicUsage, requestMessages, responseOf, type AnthropicLike } from './anthropic';
import { runAgent } from './loop';
import { planTool, PLAN_STATE } from './plan';
import { reviewHook, reviewSchema } from './review';
import { call, reply, ScriptedModel } from './scripted';
import { SkillRegistry } from './skills';
import { AgentOutputError, runStructured } from './structured';
import { delegateTool, SUBAGENT_USAGE } from './subagent';
import { defineTool, inputSchemaOf, renderToolOutput, TOOL_RESULT_LIMIT, ToolRegistry } from './tools';
import type { ContentBlock, Message, ToolResultBlock, Usage } from './types';

const signal = () => new AbortController().signal;
const results = (message: Message) => (message.content as ContentBlock[]).filter((block): block is ToolResultBlock => block.type === 'tool_result');

// ─── Skills ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a guide is listed by name, loaded once with its tools, and a second request says it is already there', async () => {
  const crm = defineTool({ name: 'crm.nota', description: 'Nota', kind: 'read', deferred: true, schema: z.object({}), run: async () => ({ status: 'ok', output: 1 }) });
  const registry = new ToolRegistry([crm]);
  const skills = new SkillRegistry([{ name: 'campanas', description: 'Armar y proponer una campaña', body: 'PASOS: 1) leer 2) redactar.', tools: ['crm.nota'] }]);
  assert.match(skills.index(), /- campanas: Armar y proponer una campaña/);
  registry.add(skills.tool(registry));
  const model = new ScriptedModel([
    reply([call('cargar_guia', { nombre: 'campanas' }, 'g1')]),
    reply([call('cargar_guia', { nombre: 'campanas' }, 'g2'), call('cargar_guia', { nombre: 'nada' }, 'g3')]),
    reply('ok'),
  ]);
  await runAgent({ model, system: 's', messages: [{ role: 'user', content: 'x' }], registry, limits: { maxRounds: 4 }, signal: signal() });
  const first = String(results(model.requests[1].messages[2])[0].content);
  assert.match(first, /PASOS: 1\) leer/);
  assert.match(first, /Herramientas cargadas con esta guía: crm\.nota/);
  const second = results(model.requests[2].messages[4]);
  assert.match(String(second[0].content), /ya está cargada/);
  assert.equal(second[1].is_error, true);
  assert.match(String(second[1].content), /Disponibles: campanas/);
  assert.equal(registry.isLoaded('crm.nota'), true);
});

// ─── Sub-agents ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a delegated task comes back as a report, with the delegate\'s reads kept out of the parent', async () => {
  const read = defineTool({ name: 'leer_pagina', description: 'Lee una página', kind: 'read', schema: z.object({ url: z.string() }), run: async ({ url }) => ({ status: 'ok', output: `contenido largo de ${url}`.repeat(50) }) });
  const parentModel = new ScriptedModel([
    reply([call('delegar', { agente: 'investigador', tarea: 'Averigua a qué se dedica la empresa X', contexto: 'dominio x.cl' }, 'd1'), call('delegar', { agente: 'investigador', tarea: 'Averigua a qué se dedica la empresa Y' }, 'd2')]),
    reply('X vende software; Y, logística.'),
  ]);
  const childModel = new ScriptedModel([
    reply([call('leer_pagina', { url: 'x.cl' })]), reply('Informe: X vende software.'),
    reply([call('leer_pagina', { url: 'y.cl' })]), reply('Informe: Y hace logística.'),
  ]);
  // Two delegates share one scripted child model: the order they call it in does not matter to the parent.
  const tool = delegateTool({ model: childModel, agents: { investigador: { description: 'Investiga una empresa', system: 'Investiga.', tools: [read] } } });
  const state = new Map<string, unknown>();
  const run = await runAgent({ model: parentModel, system: 's', messages: [{ role: 'user', content: 'compara X e Y' }], registry: new ToolRegistry([tool]), limits: { maxRounds: 3 }, signal: signal(), state });
  assert.equal(run.text, 'X vende software; Y, logística.');
  const reports = results(parentModel.requests[1].messages[2]).map(block => String(block.content));
  assert.equal(reports.length, 2);
  assert.ok(reports.every(report => report.length < 60), 'the parent got the delegate\'s page, not its report');
  assert.match(reports[0], /Informe/);
  const delegated = state.get(SUBAGENT_USAGE) as Usage;
  assert.ok(delegated.inputTokens > 0);
  // The child's first request carried the context.
  assert.match(String(childModel.requests[0].messages[0].content), /dominio x\.cl/);
});

test('a delegate cannot delegate again', async () => {
  const model = new ScriptedModel([reply([call('delegar', { agente: 'a', tarea: 'Otra tarea para otro agente' })]), reply('listo')]);
  const tool = delegateTool({ model, agents: { a: { description: 'a', system: 's', tools: [] } }, maxDepth: 1 });
  const registry = new ToolRegistry([tool]);
  const ctxRun = await tool.run({ agente: 'a', tarea: 'Hazlo tú mismo por favor', contexto: undefined }, { signal: signal(), round: 1, depth: 1, state: new Map(), note: () => undefined });
  assert.equal(ctxRun.status, 'error');
  assert.match((ctxRun as { message: string }).message, /ya es un delegado/);
  assert.equal(registry.get('delegar')?.kind, 'read');
});

// ─── Structured results ────────────────────────────────────────────────────────────────────────────────────────────────────

const reportSchema = z.object({ resumen: z.string().min(5), cifras: z.array(z.number()).min(1) });

test('the result is delivered by calling the tool, and one that does not fit is sent back with what is wrong', async () => {
  const lookup = defineTool({ name: 'leer', description: 'leer', kind: 'read', schema: z.object({}), run: async () => ({ status: 'ok', output: [1, 2] }) });
  const model = new ScriptedModel([
    reply([call('leer', {})]),
    reply([call('entregar', { resumen: 'ok', cifras: [] })]),
    reply([call('entregar', { resumen: 'Dos cifras leídas', cifras: [1, 2] })]),
  ]);
  const { data, run } = await runStructured({ model, system: 's', prompt: 'haz el informe', schema: reportSchema, tools: [lookup], signal: signal() });
  assert.deepEqual(data, { resumen: 'Dos cifras leídas', cifras: [1, 2] });
  assert.equal(run.stopReason, 'final_tool');
  const problems = String(results(model.requests[2].messages[4])[0].content);
  assert.match(problems, /no cumple el formato/);
  assert.match(problems, /resumen/);
  assert.match(problems, /cifras/);
});

test('a model that closes in prose is sent back to deliver, and a check the schema cannot say sends it back too', async () => {
  const model = new ScriptedModel([
    reply('Aquí está el informe: ...'),
    reply([call('entregar', { resumen: 'Resumen largo', cifras: [5] })]),
    reply([call('entregar', { resumen: 'Resumen largo', cifras: [5, 6] })]),
  ]);
  const { data } = await runStructured({ model, system: 's', prompt: 'x', schema: reportSchema, signal: signal(), limits: { maxRounds: 5 },
    validate: value => (value.cifras.length < 2 ? 'Faltan cifras: entrega al menos dos.' : null) });
  assert.deepEqual(data.cifras, [5, 6]);
  assert.match(String(model.requests[1].messages[2].content), /No entregaste el resultado/);
  assert.match(String(results(model.requests[2].messages[4])[0].content), /Faltan cifras/);
});

test('a run that never delivers fails with the run attached', async () => {
  const model = new ScriptedModel([reply('prosa'), reply('más prosa'), reply('y más prosa')]);
  await assert.rejects(runStructured({ model, system: 's', prompt: 'x', schema: reportSchema, signal: signal(), limits: { maxRounds: 3 } }), (error: unknown) => {
    assert.ok(error instanceof AgentOutputError);
    assert.equal(error.run.rounds >= 1, true);
    return true;
  });
});

test('images and documents go in the prompt as they are', async () => {
  const model = new ScriptedModel([reply([call('entregar', { resumen: 'Lo que dice la imagen', cifras: [1] })])]);
  const prompt: ContentBlock[] = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'Describe esto' }];
  await runStructured({ model, system: 's', prompt, schema: reportSchema, signal: signal() });
  assert.deepEqual((model.requests[0].messages[0].content as ContentBlock[])[0], prompt[0]);
});

// ─── Reviewer ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the reviewer runs the plain checks first and only then asks a model, which sends back or lets it pass', async () => {
  const reviewerModel = new ScriptedModel([
    reply([call('entregar', { verdict: 'fix', issues: ['La cifra 42 no está en la evidencia.'] })]),
    reply([call('entregar', { verdict: 'pass', issues: [] })]),
  ]);
  const hook = reviewHook<{ reply: string }>({
    model: reviewerModel, request: () => '¿cuántos contactos tengo?', evidence: () => 'leads.search: 7 contactos', render: output => output.reply, signal: signal(),
    checks: [output => (/\[completar\]/.test(output.reply) ? 'Quedó un [completar] sin resolver.' : null)],
  });
  const info = (reply: string) => ({ round: 1, output: { reply }, text: '', via: 'final_tool' as const, messages: [] });
  assert.match(String(await hook(info('Tienes [completar] contactos'))), /\[completar\]/);
  assert.equal(reviewerModel.calls, 0);
  const fix = String(await hook(info('Tienes 42 contactos')));
  assert.match(fix, /La cifra 42 no está en la evidencia/);
  assert.match(fix, /sin cambiar lo que estaba bien/);
  assert.equal(await hook(info('Tienes 7 contactos')), null);
  assert.match(String(reviewerModel.requests[0].messages[0].content), /LO QUE LA PERSONA PIDIÓ:\n¿cuántos contactos tengo\?/);
  assert.match(String(reviewerModel.requests[0].messages[0].content), /7 contactos/);
  assert.equal(reviewSchema.safeParse({ verdict: 'fix', issues: [] }).success, true);
});

// ─── Plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the plan is kept in the run and shown as it changes', async () => {
  const shown: string[][] = [];
  const model = new ScriptedModel([
    reply([call('actualizar_plan', { pasos: [{ paso: 'Leo tus contactos', estado: 'en_curso' }, { paso: 'Te resumo', estado: 'pendiente' }] })]),
    reply([call('actualizar_plan', { pasos: [{ paso: 'Leo tus contactos', estado: 'hecho' }, { paso: 'Te resumo', estado: 'hecho' }] })]),
    reply('fin'),
  ]);
  const state = new Map<string, unknown>();
  await runAgent({ model, system: 's', messages: [{ role: 'user', content: 'x' }], registry: new ToolRegistry([planTool(steps => { shown.push(steps.map(step => `${step.label}:${step.status}`)); })]), limits: { maxRounds: 4 }, signal: signal(), state });
  assert.deepEqual(shown, [['Leo tus contactos:en_curso', 'Te resumo:pendiente'], ['Leo tus contactos:hecho', 'Te resumo:hecho']]);
  assert.equal((state.get(PLAN_STATE) as unknown[]).length, 2);
  assert.match(String(results(model.requests[1].messages[2])[0].content), /Faltan 2 paso/);
  assert.match(String(results(model.requests[2].messages[4])[0].content), /Plan completo/);
});

// ─── Tool results ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a result is written as the tool says it, cut when it is too long, and a schema becomes the model\'s input description', () => {
  assert.equal(renderToolOutput({ status: 'ok', output: { a: 1 } }), '{"a":1}');
  assert.equal(renderToolOutput({ status: 'ok', output: { a: 1 }, text: 'Una línea.' }), 'Una línea.');
  const long = renderToolOutput({ status: 'ok', output: 'x'.repeat(TOOL_RESULT_LIMIT + 500) });
  assert.match(long, /resultado recortado: 500 caracteres más/);
  const schema = inputSchemaOf(z.object({ q: z.string().describe('qué buscar'), limit: z.number().int().optional() }));
  assert.equal(schema.type, 'object');
  assert.equal('$schema' in schema, false);
  assert.deepEqual(schema.required, ['q']);
  assert.equal(inputSchemaOf(z.string()).type, 'object');
});

// ─── Anthropic client ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('the request caches the rules and the conversation so far, leaves thinking to the model, and drops it when a tool is forced', () => {
  const messages: Message[] = [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'pienso', signature: 'sig' }, { type: 'tool_use', id: 't1', name: 'consultar', input: { a: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'resultado', is_error: true }] },
  ];
  const tools = [{ name: 'consultar', description: 'c', inputSchema: { type: 'object', properties: {} } }];
  const request = anthropicRequest({ system: 'reglas', messages, tools, effort: 'medium', maxTokens: 5_000 }, 'claude-sonnet-5-5');
  assert.equal(request.max_tokens, 5_000 + 8_000);
  assert.deepEqual(request.system, [{ type: 'text', text: 'reglas', cache_control: { type: 'ephemeral' } }]);
  assert.deepEqual(request.output_config, { effort: 'medium' });
  assert.equal('thinking' in request, false);
  assert.equal('tool_choice' in request, false);
  assert.deepEqual(request.tools, [{ name: 'consultar', description: 'c', input_schema: { type: 'object', properties: {} } }]);
  const last = request.messages[2].content as Array<Record<string, unknown>>;
  assert.deepEqual(last[0], { type: 'tool_result', tool_use_id: 't1', content: 'resultado', is_error: true, cache_control: { type: 'ephemeral' } });
  // Only the last block carries the breakpoint, and the thinking block goes back exactly as it came.
  assert.equal(JSON.stringify(request.messages[1]).includes('cache_control'), false);
  assert.deepEqual((request.messages[1].content as unknown[])[0], { type: 'thinking', thinking: 'pienso', signature: 'sig' });
  const forced = anthropicRequest({ system: 's', messages, tools, toolChoice: { type: 'tool', name: 'consultar' } }, 'claude-haiku-5-5');
  assert.deepEqual(forced.thinking, { type: 'disabled' });
  assert.deepEqual(forced.tool_choice, { type: 'tool', name: 'consultar' });
  // The models that think on every turn reject a forced tool and a thinking turned off: the last round asks for the tool with `auto` instead.
  for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']) {
    const lastRound = anthropicRequest({ system: 's', messages, tools, toolChoice: { type: 'tool', name: 'consultar' } }, model);
    assert.equal('thinking' in lastRound, false, model);
    assert.deepEqual(lastRound.tool_choice, { type: 'auto' }, model);
  }
  assert.deepEqual(anthropicRequest({ system: 's', messages, tools, toolChoice: { type: 'none' } }, 'claude-sonnet-5-5').tool_choice, { type: 'none' });
  assert.deepEqual(requestMessages([{ role: 'user', content: 'x' }])[0].content, [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }]);
});

test('the answer is read back into blocks, stop reason and usage the loop understands', () => {
  const response = responseOf({
    model: 'claude-sonnet-5-5-20261001', stop_reason: 'tool_use',
    content: [{ type: 'thinking', thinking: 'a', signature: 's' }, { type: 'text', text: 'Voy a mirar.' }, { type: 'tool_use', id: 'x', name: 'consultar', input: { k: 1 } }, { type: 'something_new', id: 'z' }],
    usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
  }, 'claude-sonnet-5-5');
  assert.equal(response.stopReason, 'tool_use');
  assert.equal(response.model, 'claude-sonnet-5-5-20261001');
  assert.deepEqual(response.content.map(block => block.type), ['thinking', 'text', 'tool_use']);
  assert.deepEqual(response.usage, { inputTokens: 1_050, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 50 });
  assert.deepEqual(anthropicUsage(null), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
});

function fakeSdk(outcomes: Array<Error | { content: Array<Record<string, unknown> & { type: string }>; stop_reason: string }>) {
  const seen: unknown[] = [];
  let index = 0;
  const sdk: AnthropicLike = { messages: { stream: params => {
    seen.push(params);
    const outcome = outcomes[Math.min(index++, outcomes.length - 1)];
    return { on: (_event, listener) => { listener('Hola', 'Hola'); }, finalMessage: async () => { if (outcome instanceof Error) throw outcome; return outcome; } };
  } } };
  return { sdk, seen };
}

test('a busy server is retried with backoff and the live text reaches the listener; anything else fails at once', async () => {
  const busy = Object.assign(new Error('overloaded'), { status: 529 });
  const ok = { content: [{ type: 'text', text: 'Hola' }], stop_reason: 'end_turn' };
  const { sdk, seen } = fakeSdk([busy, busy, ok]);
  const deltas: string[] = [];
  const model = anthropicModel({ model: 'claude-haiku-5-5', client: sdk, backoffMs: 1 });
  const response = await model.complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], onText: delta => deltas.push(delta) });
  assert.equal(response.stopReason, 'end_turn');
  assert.equal(seen.length, 3);
  assert.deepEqual(deltas, ['Hola', 'Hola', 'Hola']);
  const refused = fakeSdk([Object.assign(new Error('bad request'), { status: 400 })]);
  await assert.rejects(anthropicModel({ model: 'm', client: refused.sdk, backoffMs: 1 }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }));
  assert.equal(refused.seen.length, 1);
  const tired = fakeSdk([busy]);
  await assert.rejects(anthropicModel({ model: 'm', client: tired.sdk, backoffMs: 1, retries: 1 }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }));
  assert.equal(tired.seen.length, 2);
});

test('the input of a tool call reaches the listener as it is written, joined by block and named by its tool', async () => {
  const start = (index: number, name: string) => ({ type: 'content_block_start', index, content_block: { type: 'tool_use', name } });
  const text = (index: number) => ({ type: 'content_block_start', index, content_block: { type: 'text' } });
  const delta = (index: number, partial: string) => ({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partial } });
  const events = [text(0), start(1, 'buscar'), delta(1, '{"q":'), delta(1, '"a"}'), start(2, 'responder'), delta(2, '{"reply":"Ho'), delta(2, 'la"}'), delta(9, 'x'), { type: 'ping' }];
  const sdk: AnthropicLike = { messages: { stream: () => ({
    on: (event, listener) => { if (event === 'streamEvent') for (const item of events) listener(item); },
    finalMessage: async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
  }) } };
  const seen: Array<{ name: string; json: string }> = [];
  await anthropicModel({ model: 'claude-sonnet-5-5', client: sdk }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], onToolInput: event => seen.push(event) });
  assert.deepEqual(seen, [
    { name: 'buscar', json: '{"q":' }, { name: 'buscar', json: '{"q":"a"}' },
    { name: 'responder', json: '{"reply":"Ho' }, { name: 'responder', json: '{"reply":"Hola"}' },
  ]);
  // A listener that throws never breaks the call, and without one nothing is subscribed.
  const broken = await anthropicModel({ model: 'm', client: sdk }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], onToolInput: () => { throw new Error('boom'); } });
  assert.equal(broken.stopReason, 'end_turn');
});

test('the loop reports a tool call as its input is written, with the round it belongs to', async () => {
  const model = new ScriptedModel([request => {
    request.onToolInput?.({ name: 'entregar', json: '{"ok"' });
    return reply([call('entregar', { ok: true })]);
  }]);
  const events: unknown[] = [];
  await runStructured({ model, system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), signal: new AbortController().signal, onEvent: event => { if (event.type === 'tool_input') events.push(event); } });
  assert.deepEqual(events, [{ type: 'tool_input', round: 1, name: 'entregar', json: '{"ok"' }]);
});
