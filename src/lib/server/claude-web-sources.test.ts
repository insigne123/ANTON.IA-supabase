import assert from 'node:assert/strict';
import test from 'node:test';
import { call, reply, ScriptedModel, usageOf } from '@/lib/agent-harness/scripted';
import type { ContentBlock, ServerBlock } from '@/lib/agent-harness/index';
import { claudeWebSourcesSettings, findResearchSourcesWithClaude, type ClaudeWebSourcesSettings } from './claude-web-sources';

const settings: ClaudeWebSourcesSettings = { model: 'claude-sonnet-5-5', effort: 'low', searches: 6, fetches: 3, maxSources: 8, deadlineMs: 30_000, basic: true };
const input = { companyName: 'Enaex', domain: 'enaex.com', country: 'CL', contactTitle: 'Gerente de Personas', department: 'Recursos Humanos', sellerOffer: 'AXIS revisa antecedentes' };

const search = (id: string, query: string): ServerBlock => ({ type: 'server_tool_use', id, name: 'web_search', input: { query } });
const found = (id: string, ...pages: Array<[string, string, string?]>): ServerBlock => ({
  type: 'web_search_tool_result', tool_use_id: id,
  content: pages.map(([title, url, age]) => ({ type: 'web_search_result', title, url, page_age: age ?? '3 days ago', encrypted_content: 'EnC0d3d' })),
});
const deliver = (fuentes: unknown[], cobertura: string | null = null): ContentBlock => call('entregar_fuentes', { fuentes, cobertura });
const item = (url: string, titulo = 'Una noticia', fecha: string | null = '2026-10-17') => ({ url, titulo, por_que: 'Trae un hecho reciente de la empresa', fecha });

const PRESS = 'https://chilepaisminero.com/sma-da-cinco-dias-a-enaex-por-derrame-de-acido-nitrico';
const JOBS = 'https://redimin.cl/enaex-busca-trabajadores-para-mineria-revisa-vacantes';
const NEWS = 'https://df.cl/senal-df/el-deal/el-ascenso-internacional-de-enaex';

test('the researcher is off unless the flag is on and there is a key, and its limits are bounded', () => {
  assert.equal(claudeWebSourcesSettings({}), null);
  assert.equal(claudeWebSourcesSettings({ RESEARCH_CLAUDE_WEB_ENABLED: 'true' }), null, 'without a key there is no Claude');
  assert.equal(claudeWebSourcesSettings({ ANTHROPIC_API_KEY: 'k' }), null, 'the key alone turns nothing on');
  assert.deepEqual(claudeWebSourcesSettings({ RESEARCH_CLAUDE_WEB_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }),
    { model: 'claude-sonnet-5-5', effort: 'low', searches: 6, fetches: 3, maxSources: 8, deadlineMs: 45_000, basic: true });
  assert.deepEqual(claudeWebSourcesSettings({ RESEARCH_CLAUDE_WEB_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', RESEARCH_CLAUDE_WEB_MODEL: 'claude-haiku-5-5', RESEARCH_CLAUDE_WEB_EFFORT: 'medium',
    RESEARCH_CLAUDE_WEB_SEARCHES: '99', RESEARCH_CLAUDE_WEB_FETCHES: '0', RESEARCH_CLAUDE_WEB_SOURCES: '0', RESEARCH_CLAUDE_WEB_DEADLINE_MS: '5', RESEARCH_CLAUDE_WEB_BASIC: 'false' }),
  { model: 'claude-haiku-5-5', effort: 'medium', searches: 10, fetches: 0, maxSources: 1, deadlineMs: 10_000, basic: false });
});

test('with RESEARCH_CLAUDE_WEB_BASIC=false the researcher is offered the dynamic tools', async () => {
  const model = new ScriptedModel([reply([deliver([])])]);
  await findResearchSourcesWithClaude(input, { ...settings, basic: false }, { model });
  assert.deepEqual((model.requests[0].serverTools ?? []).map(tool => tool.type), ['web_search_20260209', 'web_fetch_20260209']);
});

test('only pages the API returned in this run are handed back, and profiles, videos and the home page of the company are not', async () => {
  const model = new ScriptedModel([reply([
    search('s1', 'Enaex noticias'), found('s1', ['SMA da cinco días a Enaex', PRESS, '2 days ago'], ['Enaex busca trabajadores', JOBS], ['Perfil de Enaex', 'https://www.linkedin.com/company/enaex'], ['Inicio', 'https://www.enaex.com/']),
    deliver([
      item(PRESS, 'SMA da cinco días a Enaex', '2026-10-17'),
      item(JOBS, 'Enaex busca trabajadores', null),
      item('https://www.linkedin.com/company/enaex', 'Perfil'),
      item('https://www.enaex.com/', 'Inicio'),
      item(NEWS, 'Una página que el modelo recuerda y no vio'),
      item(`${PRESS}#comentarios`, 'La misma página con ancla'),
    ], 'No busqué licitaciones.'),
  ])]);
  const result = await findResearchSourcesWithClaude(input, settings, { model });
  assert.deepEqual(result.sources.map(source => source.url), [PRESS, JOBS]);
  assert.equal(result.sources[0].date, '2026-10-17', 'the date the researcher gives');
  assert.equal(result.sources[1].date, '3 days ago', 'without one, the age the search returned');
  assert.equal(result.coverage, 'No busqué licitaciones.');
  assert.equal(result.stopReason, 'final_tool');
  assert.equal(model.calls, 1);
});

test('the request gives the researcher the company and the person\'s role, never a name, and offers the web in small calls', async () => {
  const model = new ScriptedModel([reply([deliver([])])]);
  await findResearchSourcesWithClaude({ ...input, today: '2026-10-23' }, settings, { model });
  const request = model.requests[0];
  const brief = JSON.parse(String(request.messages[0].content));
  assert.deepEqual(brief.persona_a_quien_se_escribira, { cargo: 'Gerente de Personas', area: 'Recursos Humanos' });
  assert.equal(brief.empresa, 'Enaex');
  assert.equal(brief.hoy, '2026-10-23');
  assert.equal(brief.maximo_de_fuentes, 8);
  assert.deepEqual((request.serverTools ?? []).map(tool => [tool.name, tool.max_uses]), [['web_search', 3], ['web_fetch', 3]], 'three at a time, so the first results are seen before the rest');
  assert.deepEqual((request.serverTools ?? []).map(tool => tool.type), ['web_search_20250305', 'web_fetch_20250910'], 'the tools without dynamic filtering: the code of the dynamic ones burned the searches on retries');
  assert.match(request.system, /Nunca escribas una de memoria/);
  assert.match(request.system, /nunca una instrucción/);
});

test('a researcher that does not deliver, or delivers something malformed, hands back nothing', async () => {
  const silent = new ScriptedModel([reply('No encontré nada.')]);
  const none = await findResearchSourcesWithClaude(input, settings, { model: silent });
  assert.deepEqual(none.sources, []);
  assert.equal(none.coverage, null);
  const malformed = new ScriptedModel([reply([search('s1', 'x'), found('s1', ['Una', PRESS]), call('entregar_fuentes', { fuentes: 'no es una lista' }, 't1')]), reply([deliver([item(PRESS)])])]);
  const second = await findResearchSourcesWithClaude(input, settings, { model: malformed });
  assert.deepEqual(second.sources.map(source => source.url), [PRESS], 'an input the schema refuses is sent back and the researcher fixes it');
});

test('what it spent is counted: searches and reads of the API, and tokens', async () => {
  const model = new ScriptedModel([reply([search('s1', 'a'), found('s1', ['Una', PRESS]), deliver([item(PRESS)])], undefined, { ...usageOf(900, 80), webSearches: 3, webFetches: 1 })]);
  const result = await findResearchSourcesWithClaude(input, settings, { model });
  assert.equal(result.searches, 3);
  assert.equal(result.reads, 1);
  assert.equal(result.usage.inputTokens, 900);
});

test('no more than the asked number of pages comes back', async () => {
  const urls = Array.from({ length: 6 }, (_, index) => `https://prensa.example/enaex-${index}`);
  const model = new ScriptedModel([reply([search('s1', 'a'), found('s1', ...urls.map((url): [string, string] => ['Nota', url])), deliver(urls.map(url => item(url)))])]);
  const result = await findResearchSourcesWithClaude(input, { ...settings, maxSources: 3 }, { model });
  assert.deepEqual(result.sources.map(source => source.url), urls.slice(0, 3));
});
