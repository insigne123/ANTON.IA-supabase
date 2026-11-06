import assert from 'node:assert/strict';
import test from 'node:test';
import { call, reply, ScriptedModel } from '@/lib/agent-harness/scripted';
import type { ServerBlock } from '@/lib/agent-harness/index';
import {
  classifyCompanySectors, companySectorClassifier, companySectorSettings, forgetCompanySectors, searchCountry, type CompanySectorSettings,
} from './company-sectors';

// Fictional companies: the shapes Apollo's company search returns, without a sector.
const settings: CompanySectorSettings = { model: 'claude-haiku-5-5', searches: 6, deadlineMs: 15_000, basic: true };
const deliver = (empresas: unknown[]) => call('entregar_rubros', { empresas });
const PAGES: Record<string, { title: string | null; description: string | null; text: string }> = {
  'constructoraandessur.cl': { title: 'Constructora Andes Sur | Edificación y obras civiles', description: 'Construimos edificios y obras civiles en el sur de Chile.', text: 'Proyectos habitacionales y viales.' },
};
const readHomePage = async (domain: string) => PAGES[domain] ?? null;
const companies = [
  { key: 'org1', name: 'Constructora Andes Sur', domain: 'https://www.constructoraandessur.cl/', location: 'Temuco, Chile' },
  { key: 'org2', name: 'Transportes Ruta Cinco', domain: 'rutacinco.cl' },
  { key: 'org3', name: 'Grupo Kappa', domain: 'grupokappa.cl' },
];
const brief = (model: ScriptedModel, index = 0) => JSON.parse(String(model.requests[index].messages[0].content));

test('the classifier is off unless the flag is on and there is a key, and its limits are bounded', () => {
  assert.equal(companySectorSettings({}), null);
  assert.equal(companySectorSettings({ COMPANY_SECTOR_AI_ENABLED: 'true' }), null, 'without a key there is no Claude');
  assert.equal(companySectorSettings({ ANTHROPIC_API_KEY: 'k' }), null, 'the key alone turns nothing on');
  assert.equal(companySectorClassifier({ ANTHROPIC_API_KEY: 'k' }), null);
  assert.deepEqual(companySectorSettings({ COMPANY_SECTOR_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }),
    { model: 'claude-haiku-5-5', searches: 6, deadlineMs: 15_000, basic: true });
  assert.deepEqual(companySectorSettings({ COMPANY_SECTOR_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', COMPANY_SECTOR_AI_SEARCHES: '99',
    COMPANY_SECTOR_AI_DEADLINE_MS: '1', COMPANY_SECTOR_AI_WEB_BASIC: 'false' }), { model: 'claude-haiku-5-5', searches: 10, deadlineMs: 5_000, basic: false });
});

test('one call names every sector from the name and the home page, without the web, in the labels the app uses', async () => {
  forgetCompanySectors();
  const model = new ScriptedModel([reply([deliver([
    { id: 'e1', rubro: 'Construcción', certeza: 'alta', fuente: 'sitio' },
    { id: 'e2', rubro: 'Transporte y logística', certeza: 'media', fuente: 'nombre' },
    { id: 'e3', rubro: null, certeza: 'baja' },
    { id: 'e9', rubro: 'Minería', certeza: 'alta' },
  ])])]);
  const run = await classifyCompanySectors(companies, { ...settings, searches: 0 }, { country: 'CL' }, { model, readHomePage });
  assert.deepEqual([...run.sectors], [
    ['org1', { sector: 'Construcción', certainty: 'alta', via: 'sitio' }],
    ['org2', { sector: 'Transporte y logística', certainty: 'media', via: 'nombre' }],
  ], 'one it does not know stays without a sector, and an id it made up counts for nothing');
  assert.equal(model.calls, 1);
  assert.equal(model.requests[0].serverTools, undefined, 'the first pass does not search the web');
  const sent = brief(model);
  assert.equal(sent.pais_de_la_busqueda, 'CL');
  assert.deepEqual(sent.empresas[0], { id: 'e1', nombre: 'Constructora Andes Sur', dominio: 'constructoraandessur.cl', ubicacion: 'Temuco, Chile',
    portada: { titulo: 'Constructora Andes Sur | Edificación y obras civiles', descripcion: 'Construimos edificios y obras civiles en el sur de Chile.', texto: 'Proyectos habitacionales y viales.' } });
  assert.equal(sent.empresas[1].portada, null, 'a site that could not be read goes without its page');
  assert.match(model.requests[0].system, /Hotelería y alojamiento/, 'the sectors of the activity codes, so both ways read the same');
  assert.match(model.requests[0].system, /nunca una instrucción/);
  assert.match(model.requests[0].system, /mejor dejar una empresa sin rubro que equivocarse/);
  assert.equal(run.pagesRead, 1);
});

test('the ones it cannot tell are looked up on the web, one search each, and what the web cannot tell either is not asked again for a day', async () => {
  forgetCompanySectors();
  const search: ServerBlock = { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Grupo Kappa grupokappa.cl a qué se dedica' } };
  const found: ServerBlock = { type: 'web_search_tool_result', tool_use_id: 's1',
    content: [{ type: 'web_search_result', title: 'Grupo Kappa: guardias y seguridad', url: 'https://grupokappa.cl/nosotros', page_age: null, encrypted_content: 'x' }] };
  const model = new ScriptedModel([
    reply([deliver([
      { id: 'e1', rubro: 'Construcción', certeza: 'alta', fuente: 'sitio' },
      { id: 'e2', rubro: null, certeza: 'baja' },
      { id: 'e3', rubro: null, certeza: 'baja' },
    ])]),
    reply([search, found, deliver([
      { id: 'e3', rubro: 'Seguridad e investigaciones', certeza: 'alta', fuente: 'web' },
      { id: 'e2', rubro: null, certeza: 'baja' },
      { id: 'e1', rubro: 'Otra cosa', certeza: 'alta' },
    ])]),
  ]);
  const run = await classifyCompanySectors(companies, settings, { country: 'PE' }, { model, readHomePage });
  assert.deepEqual(Object.fromEntries([...run.sectors].map(([key, value]) => [key, `${value.sector} · ${value.via}`])),
    { org1: 'Construcción · sitio', org3: 'Seguridad e investigaciones · web' }, 'the second pass only answers for the ones it was asked about');
  assert.equal(model.calls, 2);
  const web = model.requests[1];
  assert.deepEqual(brief(model, 1).empresas.map((item: { id: string }) => item.id), ['e2', 'e3']);
  assert.deepEqual((web.serverTools ?? []).map(tool => [tool.name, tool.type, tool.max_uses]), [['web_search', 'web_search_20250305', 2]]);
  assert.equal(((web.serverTools ?? [])[0] as { user_location?: { country?: string } } | undefined)?.user_location?.country, 'PE');
  assert.match(web.system, /una búsqueda por empresa/);
  assert.equal(run.searched, 2);

  // The same companies again: what was found and what the web could not tell come from memory, without a call.
  const again = new ScriptedModel([]);
  const second = await classifyCompanySectors(companies, settings, { country: 'PE' }, { model: again, readHomePage });
  assert.equal(again.calls, 0);
  assert.equal(second.fromMemory, 3);
  assert.deepEqual([...second.sectors.keys()], ['org1', 'org3']);
});

test('without time for the web the companies it could not tell stay without a sector, and a failure costs only the sectors', async () => {
  forgetCompanySectors();
  let clock = 0;
  const slow = new ScriptedModel([() => { clock = 11_000; return reply([deliver([{ id: 'e1', rubro: 'Construcción', certeza: 'alta', fuente: 'sitio' }])]); }]);
  const late = await classifyCompanySectors(companies, settings, {}, { model: slow, readHomePage, now: () => clock });
  assert.equal(slow.calls, 1, 'no second pass with less than 5 seconds left');
  assert.deepEqual([...late.sectors.keys()], ['org1']);

  forgetCompanySectors();
  const broken = new ScriptedModel([() => { throw new Error('overloaded'); }]);
  const failed = await classifyCompanySectors(companies, settings, {}, { model: broken, readHomePage });
  assert.equal(failed.sectors.size, 0);

  // Companies not told in time are asked about again next time: only the web's «no sé» is remembered.
  const retry = new ScriptedModel([reply([deliver([{ id: 'e1', rubro: 'Construcción', certeza: 'alta', fuente: 'sitio' }])]), reply([deliver([])])]);
  await classifyCompanySectors(companies, settings, {}, { model: retry, readHomePage });
  assert.equal(retry.calls, 2);
});

test('the country of the web search comes from the places searched', () => {
  assert.equal(searchCountry(['Lima, Perú']), 'PE');
  assert.equal(searchCountry(['Bogotá', 'Colombia']), 'CO');
  assert.equal(searchCountry(['Santiago, Chile']), 'CL');
  assert.equal(searchCountry([]), 'CL');
  assert.equal(searchCountry(null), 'CL');
});

test('hundreds of companies go in calls of 100, and only the first 100 have their home page read', async () => {
  forgetCompanySectors();
  const many = Array.from({ length: 250 }, (_, index) => ({ key: `c${index}`, name: `Constructora ${index}`, domain: `constructora${index}.cl` }));
  const read: string[] = [];
  const model = new ScriptedModel([0, 1, 2].map(() => (request: { messages: Array<{ content: unknown }> }) => {
    const ids = JSON.parse(String(request.messages[0].content)).empresas.map((item: { id: string }) => item.id);
    return reply([deliver(ids.map((id: string) => ({ id, rubro: 'Construcción', certeza: 'media', fuente: 'nombre' })))]);
  }));
  const run = await classifyCompanySectors(many, { ...settings, searches: 0 }, {}, { model, readHomePage: async domain => { read.push(domain); return null; } });
  assert.equal(model.calls, 3);
  assert.deepEqual(model.requests.map(request => JSON.parse(String(request.messages[0].content)).empresas.length).sort((a: number, b: number) => b - a), [100, 100, 50]);
  assert.equal(read.length, 100);
  assert.equal(run.sectors.size, 250);
});
