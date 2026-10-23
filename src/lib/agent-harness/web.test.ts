import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { anthropicModel, anthropicRequest, anthropicUsage, requestMessages, responseOf, type AnthropicLike } from './anthropic';
import { estimateTokens, transcriptOf } from './context';
import { runAgent } from './loop';
import { call, reply, ScriptedModel, usageOf } from './scripted';
import { defineTool, ToolRegistry } from './tools';
import type { AgentEvent, ContentBlock, Message, ServerToolSpec } from './types';
import { addUsage, emptyUsage } from './types';
import { describeWebAction, webActions, webToolSpecs } from './web';

const signal = () => new AbortController().signal;
const answer = defineTool({
  name: 'responder', description: 'Entrega la respuesta', kind: 'meta', schema: z.object({ reply: z.string().min(1) }),
  run: async ({ reply: text }) => ({ status: 'final', output: { reply: text }, text }),
});

const search = (id: string, query: string): ContentBlock => ({ type: 'server_tool_use', id, name: 'web_search', input: { query } });
const found = (id: string, ...pages: Array<[string, string]>): ContentBlock => ({
  type: 'web_search_tool_result', tool_use_id: id,
  content: pages.map(([title, url]) => ({ type: 'web_search_result', title, url, page_age: '2 days ago', encrypted_content: 'EnC0d3d' })),
});
const read = (id: string, url: string): ContentBlock => ({ type: 'server_tool_use', id, name: 'web_fetch', input: { url } });
const page = (id: string, url: string, data: string): ContentBlock => ({
  type: 'web_fetch_tool_result', tool_use_id: id,
  content: { type: 'web_fetch_result', url, retrieved_at: '2026-10-23T04:19:03+00:00', content: { type: 'document', title: 'Inicio', source: { type: 'text', media_type: 'text/plain', data } } },
});
const code: ContentBlock = { type: 'server_tool_use', id: 'srv_code', name: 'code_execution', input: { code: 'print(1)' } };
const codeResult: ContentBlock = { type: 'code_execution_tool_result', tool_use_id: 'srv_code', content: { type: 'encrypted_code_execution_result', encrypted_stdout: 'xx' } };

test('the web tools are offered whole until their budget is spent, and then they are not offered', () => {
  const web = { searches: 4, fetches: 3, blockedDomains: ['spam.example'], country: 'CL', timezone: 'America/Santiago', maxPageTokens: 20_000 };
  assert.deepEqual(webToolSpecs(web), [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 4, blocked_domains: ['spam.example'], user_location: { type: 'approximate', country: 'CL', timezone: 'America/Santiago' } },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, blocked_domains: ['spam.example'], max_content_tokens: 20_000 },
  ]);
  // The definition does not change while there is budget: the model's cache starts with the tools.
  assert.deepEqual(webToolSpecs(web, { webSearches: 3, webFetches: 2 }), webToolSpecs(web));
  assert.deepEqual(webToolSpecs(web, { webSearches: 4 }).map(tool => tool.name), ['web_fetch']);
  assert.deepEqual(webToolSpecs(web, { webSearches: 5, webFetches: 3 }), []);
  assert.deepEqual(webToolSpecs({ searches: 0, fetches: 0 }), []);
  assert.deepEqual(webToolSpecs({ searches: 2, fetches: 0 }), [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }]);
});

test('the searches and page reads of a response are read with what came back, and the code that filters them is left out', () => {
  const actions = webActions([
    code,
    search('s1', 'licitaciones aseo hospitales 2026'),
    found('s1', ['Mercado Público', 'https://www.mercadopublico.cl'], ['Chile Compra', 'https://www.chilecompra.cl']),
    read('f1', 'https://www.sodexo.cl'),
    page('f1', 'https://www.sodexo.cl', 'Líder mundial en servicios de alimentación'),
    read('f2', 'https://nada.cl'),
    { type: 'web_fetch_tool_result', tool_use_id: 'f2', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_allowed' } },
    search('s2', 'algo que falla'),
    { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } },
    codeResult,
    { type: 'text', text: 'Listo.' },
  ]);
  assert.deepEqual(actions.map(action => [action.tool, action.input, action.ok]), [
    ['web_search', 'licitaciones aseo hospitales 2026', true], ['web_fetch', 'https://www.sodexo.cl', true],
    ['web_fetch', 'https://nada.cl', false], ['web_search', 'algo que falla', false],
  ]);
  assert.deepEqual(actions[0].sources, [
    { title: 'Mercado Público', url: 'https://www.mercadopublico.cl', age: '2 days ago' }, { title: 'Chile Compra', url: 'https://www.chilecompra.cl', age: '2 days ago' },
  ]);
  assert.equal(actions[1].excerpt, 'Líder mundial en servicios de alimentación');
  assert.deepEqual(actions[1].sources, [{ title: 'Inicio', url: 'https://www.sodexo.cl', age: '2026-10-23T04:19:03+00:00' }]);
  assert.equal(actions[2].error, 'url_not_allowed');
  assert.equal(actions[3].error, 'too_many_requests');
  assert.equal(describeWebAction(actions[0]), 'Búsqueda «licitaciones aseo hospitales 2026»: 2 resultados');
  assert.equal(describeWebAction(actions[1]), 'Lectura de https://www.sodexo.cl: leída');
  assert.equal(describeWebAction(actions[2]), 'Lectura de https://nada.cl: no se pudo (url_not_allowed)');
  // A call whose result never came back is a failure, not a success without pages.
  assert.equal(webActions([search('x', 'q')])[0].ok, false);
  assert.deepEqual(webActions([{ type: 'text', text: 'nada' }]), []);
});

test('the request puts the API\'s own tools first and keeps the cache breakpoint on the last message of the person\'s side', () => {
  const server: ServerToolSpec[] = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  const tools = [{ name: 'consultar', description: 'c', inputSchema: { type: 'object', properties: {} } }];
  const request = anthropicRequest({ system: 's', messages: [{ role: 'user', content: 'hola' }], tools, serverTools: server }, 'claude-sonnet-5-5');
  assert.deepEqual(request.tools, [server[0], { name: 'consultar', description: 'c', input_schema: { type: 'object', properties: {} } }]);
  assert.equal('tool_choice' in request, false);
  // Only the API's tools, no tool of the harness: they are still sent.
  assert.deepEqual(anthropicRequest({ system: 's', messages: [{ role: 'user', content: 'hola' }], tools: [], serverTools: server }, 'claude-sonnet-5-5').tools, server);
  assert.equal('tools' in anthropicRequest({ system: 's', messages: [{ role: 'user', content: 'hola' }], tools: [] }, 'claude-sonnet-5-5'), false);

  // A turn paused in the middle of a search goes back as it came: it ends with the model's blocks, so the breakpoint stays on the user's message.
  const paused: Message[] = [
    { role: 'user', content: 'investiga' },
    { role: 'assistant', content: [search('s1', 'q'), found('s1', ['A', 'https://a.cl']), search('s2', 'q2')] },
  ];
  const messages = requestMessages(paused);
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'investiga', cache_control: { type: 'ephemeral' } }]);
  assert.equal(JSON.stringify(messages[1]).includes('cache_control'), false);
  assert.deepEqual(messages[1].content, paused[1].content, 'the API\'s blocks go back untouched');
});

test('a response keeps the API\'s own blocks and citations as they came, and counts the searches', () => {
  const citations = [{ type: 'web_search_result_location', url: 'https://a.cl', title: 'A', encrypted_index: 'abc', cited_text: 'x' }];
  const response = responseOf({
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'a', signature: 's' }, { ...code }, { ...search('s1', 'q') }, { ...found('s1', ['A', 'https://a.cl']) }, { ...codeResult },
      { type: 'text', text: 'Según A…', citations }, { type: 'text', text: 'sin fuentes', citations: [] }, { type: 'tool_use', id: 'x', name: 'responder', input: { reply: 'ok' } },
      { type: 'mcp_tool_use', id: 'never' },
    ],
    usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } },
  }, 'claude-sonnet-5-5');
  assert.deepEqual(response.content.map(block => block.type), ['thinking', 'server_tool_use', 'server_tool_use', 'web_search_tool_result', 'code_execution_tool_result', 'text', 'text', 'tool_use']);
  assert.deepEqual(response.content[3], found('s1', ['A', 'https://a.cl']));
  assert.deepEqual(response.content[5], { type: 'text', text: 'Según A…', citations });
  assert.deepEqual(response.content[6], { type: 'text', text: 'sin fuentes' }, 'empty citations are not sent back');
  assert.deepEqual(response.usage, { inputTokens: 1_000, outputTokens: 40, cacheReadTokens: 900, cacheWriteTokens: 0, webSearches: 2, webFetches: 1 });
  assert.deepEqual(anthropicUsage({ input_tokens: 5, server_tool_use: { web_search_requests: 0 } }), { inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.deepEqual(addUsage({ ...emptyUsage(), webSearches: 1 }, { ...emptyUsage(), webSearches: 2, webFetches: 1 }), { ...emptyUsage(), webSearches: 3, webFetches: 1 });
  assert.deepEqual(addUsage(emptyUsage(), emptyUsage()), emptyUsage(), 'no web fields when there was no web');
});

test('the input of a search reaches the listener while it is written, named by the API\'s tool', async () => {
  const events = [
    { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', name: 'web_search' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"aseo ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'hospitales"}' } },
  ];
  const sdk: AnthropicLike = { messages: { stream: () => ({
    on: (event, listener) => { if (event === 'streamEvent') for (const item of events) listener(item); },
    finalMessage: async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
  }) } };
  const seen: string[] = [];
  await anthropicModel({ model: 'claude-sonnet-5-5', client: sdk }).complete({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], onToolInput: event => seen.push(`${event.name}:${event.json}`) });
  assert.deepEqual(seen, ['web_search:{"query":"aseo ', 'web_search:{"query":"aseo hospitales"}']);
});

test('the loop offers the API\'s tools on every round but the last, shows what they did and keeps the blocks in the conversation', async () => {
  const spent: number[] = [];
  const offered = (request: { serverTools?: ServerToolSpec[] }) => (request.serverTools ?? []).map(tool => tool.name);
  const model = new ScriptedModel([
    reply([code, search('s1', 'q'), found('s1', ['A', 'https://a.cl']), codeResult, call('responder', { reply: 'ya' }, 't1')], undefined, { ...usageOf(), webSearches: 1 }),
  ]);
  const events: AgentEvent[] = [];
  const run = await runAgent({
    model, system: 's', messages: [{ role: 'user', content: 'investiga' }], registry: new ToolRegistry([answer]), finalTool: 'responder', limits: { maxRounds: 3 }, signal: signal(),
    serverTools: usage => { spent.push(usage.webSearches ?? 0); return webToolSpecs({ searches: 1, fetches: 1 }, usage); },
    onEvent: event => events.push(event),
  });
  assert.equal(run.stopReason, 'final_tool');
  assert.deepEqual(offered(model.requests[0]), ['web_search', 'web_fetch']);
  assert.deepEqual(spent, [0]);
  assert.deepEqual(events.filter(event => event.type === 'tool_start' || event.type === 'tool_end').map(event => `${event.type}:${(event as { name: string }).name}`),
    ['tool_start:web_search', 'tool_end:web_search', 'tool_start:responder', 'tool_end:responder'], 'the filtering code is not an action of the person');
  const end = events.find(event => event.type === 'tool_end' && event.name === 'web_search');
  assert.equal(end?.type === 'tool_end' && end.summary, 'Búsqueda «q»: 1 resultado');
  assert.equal(run.usage.webSearches, 1);
  assert.deepEqual((run.messages[1].content as ContentBlock[]).map(block => block.type), ['server_tool_use', 'server_tool_use', 'web_search_tool_result', 'code_execution_tool_result', 'tool_use']);

  // The last round only answers: nothing else is offered there, and a spent budget is not offered either.
  const lastModel = new ScriptedModel([reply([call('responder', { reply: 'fin' })])]);
  await runAgent({ model: lastModel, system: 's', messages: [{ role: 'user', content: 'x' }], registry: new ToolRegistry([answer]), finalTool: 'responder', limits: { maxRounds: 1 }, signal: signal(),
    serverTools: webToolSpecs({ searches: 2, fetches: 2 }) });
  assert.deepEqual(offered(lastModel.requests[0]), []);
});

test('a turn the API paused goes back as it came, with nothing added, and the work goes on', async () => {
  const model = new ScriptedModel([
    reply([search('s1', 'q1'), found('s1', ['A', 'https://a.cl']), search('s2', 'q2')], 'pause_turn'),
    reply([found('s2', ['B', 'https://b.cl']), call('responder', { reply: 'listo' })]),
  ]);
  const run = await runAgent({
    model, system: 's', messages: [{ role: 'user', content: 'investiga' }], registry: new ToolRegistry([answer]), finalTool: 'responder', limits: { maxRounds: 4 }, signal: signal(),
    serverTools: webToolSpecs({ searches: 3, fetches: 0 }),
  });
  assert.equal(run.stopReason, 'final_tool');
  assert.equal(run.rounds, 2);
  const second = model.requests[1].messages;
  assert.deepEqual(second.map(message => message.role), ['user', 'assistant'], 'no «continúa» is added: the trailing call is what resumes it');
  assert.deepEqual((second[1].content as ContentBlock[]).map(block => block.type), ['server_tool_use', 'web_search_tool_result', 'server_tool_use']);
  assert.deepEqual(model.requests[1].serverTools?.map(tool => tool.name), ['web_search']);
});

test('what the API ran counts toward the size of the conversation and shows in a summary', () => {
  const messages: Message[] = [
    { role: 'user', content: 'investiga' },
    { role: 'assistant', content: [search('s1', 'licitaciones aseo'), found('s1', ['A', 'https://a.cl']), read('f1', 'https://sodexo.cl'), code, codeResult] },
  ];
  assert.ok(estimateTokens(messages) > 2_900, 'a result is worth reading even though its text is not ours');
  assert.equal(transcriptOf(messages), 'Usuario: investiga\nAgente buscó en la web licitaciones aseo\nAgente leyó la página https://sodexo.cl');
});
