import assert from 'node:assert/strict';
import test from 'node:test';

import { clearCompanyPeopleCache, companyPeopleByTitle } from './company-people-ai';
import { clearTitleAiCache } from './title-ai';

/** Apollo's people search as it behaves: a title matches when it has the asked words one after the other, written exactly so. */
const has = (title: string, asked: string) => ` ${title.toLowerCase()} `.includes(` ${asked.toLowerCase()} `);
function company(size: number, extra: Record<number, string>) {
  return Array.from({ length: size }, (_, index) => ({ id: `p${index}`, title: extra[index] || (index % 50 === 0 ? 'Jefe Prevención de Riesgos' : 'Analista') }));
}
const apollo = (people: Array<{ id: string; title: string }>, calls: Array<Record<string, unknown>>) => async (payload: Record<string, unknown>) => {
  calls.push(payload);
  const titles = (payload.titles as string[]) || [];
  const matching = titles.length ? people.filter((person) => titles.some((title) => has(person.title, title))) : people;
  const page = Number(payload.page);
  const leads = matching.slice((page - 1) * 100, page * 100);
  return { ok: true as const, json: { leads, raw_count: leads.length, total_entries: matching.length } };
};
const classify = async (options: any) => {
  const prompt = JSON.parse(options.prompt);
  if (!prompt.cargoBuscado) {
    // The search terms: Apollo can match «incendios» and «riesgo», not the asked title as written.
    return { titles: [{ i: 0, variants: ['Coordinador de Gestión de Riesgos de Incendio'], keywords: ['incendio', 'incendios', 'riesgo', 'riesgos'] }] };
  }
  return { titles: (prompt.cargos as Array<{ i: number; cargo: string }>).map((entry) => ({ i: entry.i, match: entry.cargo.startsWith('Jefe') ? 'similar' : 'none' })) };
};
const asked = ['coordinador de gestión de riesgo en incendio'];

test('a company of up to 300 people is read whole and the exact person comes first, even on the last page', async () => {
  clearCompanyPeopleCache(); clearTitleAiCache();
  const calls: Array<Record<string, unknown>> = [];
  const people = company(230, { 207: 'Coordinador Gestión Riesgo Incendios' });
  const answer = await companyPeopleByTitle({
    base: { organization_id: 'org-1', search_mode: 'organization_people' }, titles: asked,
    page: 1, perPage: 2, all: false, excludeIds: [], run: apollo(people, calls), cacheKey: 'k1', deps: { generate: classify },
  });
  assert.ok(answer.ok);
  // Three pages of a hundred, without titles: Apollo would have found nobody with the title as asked.
  assert.deepEqual(calls.map((call) => [call.page, call.per_page, (call.titles as unknown[]).length]), [[1, 100, 0], [2, 100, 0], [3, 100, 0]]);
  assert.deepEqual(answer.json.leads.map((lead: any) => [lead.id, lead.title_match]), [['p207', 'exact'], ['p0', 'similar']]);
  assert.equal(answer.json.total_entries, 6);
  assert.equal(answer.json.title_strategy, 'everyone');
  // The next page comes from the list already read.
  const next = await companyPeopleByTitle({
    base: { organization_id: 'org-1' }, titles: asked, page: 2, perPage: 2, all: false, excludeIds: ['p50'], run: apollo(people, calls), cacheKey: 'k1',
    deps: { generate: classify },
  });
  assert.equal(calls.length, 3);
  assert.ok(next.ok && next.json.leads.every((lead: any) => lead.id !== 'p50'));
});

test('a larger company is read by the titles and the words of their area, in at most five calls', async () => {
  clearCompanyPeopleCache(); clearTitleAiCache();
  const calls: Array<Record<string, unknown>> = [];
  // 991 people, the one asked for on page 9 of everyone, as in the case of 12 Nov 2026.
  const people = company(991, { 870: 'Coordinador Gestión Riesgo Incendios', 400: 'Brigadista Incendios Forestales' });
  const answer = await companyPeopleByTitle({
    base: { organization_id: 'org-big', include_similar_titles: true }, titles: asked, page: 1, perPage: 50, all: false, excludeIds: [],
    run: apollo(people, calls), cacheKey: 'k-big', deps: { generate: classify },
  });
  assert.ok(answer.ok);
  assert.ok(calls.length <= 5, `calls: ${calls.length}`);
  assert.deepEqual(calls.map((call) => [call.page, (call.titles as string[]).length, call.include_similar_titles]), [
    [1, 0, false], [1, 2, true], [1, 4, false],
  ]);
  assert.equal(answer.json.leads[0].id, 'p870');
  assert.equal(answer.json.leads[0].title_match, 'exact');
  assert.equal(answer.json.title_strategy, 'titles');
  assert.equal(answer.json.company_people_total, 991);
});

test('«0 = todos» without titles brings everyone up to a thousand, and Apollo failing on the first page is said', async () => {
  clearCompanyPeopleCache();
  const calls: Array<Record<string, unknown>> = [];
  const all = await companyPeopleByTitle({ base: { organization_id: 'org-2' }, titles: [], page: 1, perPage: 50, all: true, excludeIds: [],
    run: apollo(company(1_234, {}), calls), cacheKey: 'k2' });
  assert.ok(all.ok && all.json.leads.length === 1_000 && all.json.total_pages === 1);
  assert.equal(calls.length, 10);
  const failed = await companyPeopleByTitle({ base: { organization_id: 'org-3' }, titles: ['x'], page: 1, perPage: 50, all: false, excludeIds: [],
    run: async () => ({ ok: false as const, error: 'APOLLO_RATE_LIMITED' }), cacheKey: 'k3' });
  assert.deepEqual(failed, { ok: false, error: 'APOLLO_RATE_LIMITED' });
});
