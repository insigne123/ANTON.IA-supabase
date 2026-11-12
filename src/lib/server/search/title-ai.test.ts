import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyTitles, clearTitleAiCache, expandTitleVariants, localKeywords, localTitleMatch, MAX_SEARCH_TITLES, rankByTitle, titleSearchTerms, titleWords,
} from './title-ai';

test('the local rule reads a title by its words, without prepositions, accents, plurals or gender', () => {
  assert.deepEqual(titleWords('Coordinador de Gestión de Riesgo en Incendio'), titleWords('Coordinador Gestión Riesgo Incendios'));
  assert.deepEqual(titleWords('Jefe de Operaciones'), titleWords('Jefa Operación'));
  assert.deepEqual(titleWords('Líderes HSE'), titleWords('Lider HSE'));
  // The case of 12 Nov 2026: Apollo found nobody with the first wording; the person has the second.
  assert.equal(localTitleMatch(['coordinador de gestión de riesgo en incendio'], 'Coordinador Gestión Riesgo Incendios'), 'exact');
  assert.equal(localTitleMatch(['jefe de prevención de riesgos'], 'Jefa Prevención Riesgos'), 'exact');
  assert.equal(localTitleMatch(['jefe de prevención de riesgos'], 'Jefe de Riesgos Operacionales'), 'similar');
  // Words that only share their first letters are not one: «seguridad» is not «seguros».
  assert.equal(localTitleMatch(['jefe de seguridad'], 'Jefe de Seguros'), 'none');
  assert.equal(localTitleMatch(['gerente de operaciones'], 'Data Engineer'), 'none');
  assert.equal(localTitleMatch(['gerente'], ''), 'none');
});

test('without the model, the words of the area go in their written forms and the level words stay out', () => {
  assert.deepEqual(localKeywords(['coordinador de gestión de riesgo en incendio']), ['riesgo', 'riesgos', 'incendio', 'incendios']);
  assert.deepEqual(localKeywords(['Gerente de Operaciones']), ['operaciones', 'operación', 'operacion']);
  assert.deepEqual(localKeywords(['Jefe de Prevención']), ['prevención', 'prevenciones', 'prevencion']);
  assert.deepEqual(localKeywords(['Gerente General']), []);
});

test('the search terms come from the model once per title, keep both accents, drop level words and never pass twenty', async () => {
  clearTitleAiCache();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return { titles: [{
      i: 0,
      variants: ['Jefe Emergencias', 'jefe de emergencias', 'Head of Emergency Response', 'Encargado de Emergencias'],
      keywords: ['emergencias', 'emergencia', 'Emergencias', 'gerente', 'respuesta a emergencias', 'Gestión'],
    }] };
  };
  const first = await titleSearchTerms(['Jefe de Emergencias'], { generate });
  assert.deepEqual(first.titles, ['Jefe de Emergencias', 'Jefe Emergencias', 'Head of Emergency Response', 'Encargado de Emergencias']);
  assert.deepEqual(first.keywords, ['emergencias', 'emergencia', 'respuesta a emergencias']);
  assert.deepEqual(await expandTitleVariants(['jefe de emergencias'], { generate }), ['jefe de emergencias', 'Jefe Emergencias', 'Head of Emergency Response', 'Encargado de Emergencias']);
  assert.equal(calls, 1);

  // Three asked titles share the twenty in turns: each keeps its own variants and its own words.
  const many = Array.from({ length: 14 }, (_, index) => `Variante ${index}`);
  const wide = await titleSearchTerms(['A uno', 'B dos', 'C tres'], {
    generate: async () => ({ titles: ['A uno', 'B dos', 'C tres'].map((asked, i) => ({
      i, variants: many.map((value) => `${asked} ${value}`), keywords: many.slice(0, 10).map((value) => `${asked.slice(0, 1)}${value}`),
    })) }),
  });
  assert.equal(wide.titles.length, MAX_SEARCH_TITLES);
  assert.deepEqual(wide.titles.slice(0, 6), ['A uno', 'B dos', 'C tres', 'A uno Variante 0', 'B dos Variante 0', 'C tres Variante 0']);
  assert.equal(wide.titles.filter((title) => title.startsWith('C tres')).length, 6);
  assert.equal(wide.keywords.length, MAX_SEARCH_TITLES);
  assert.deepEqual(wide.keywords.slice(0, 3), ['AVariante 0', 'BVariante 0', 'CVariante 0']);

  // The model failing leaves the asked titles and the local words.
  clearTitleAiCache();
  assert.deepEqual(await titleSearchTerms(['Gerente HSE'], { generate: async () => { throw new Error('down'); } }), { titles: ['Gerente HSE'], keywords: ['hse'] });
});

test('titles are classified by the model, the local rule only raises its answer, and a failed call falls back to the rule', async () => {
  clearTitleAiCache();
  const asked = ['coordinador de gestión de riesgo en incendio'];
  const titles = ['Coordinador Gestión Riesgo Incendios', 'Jefe Prevención de Riesgos', 'Corporate Risk Manager', 'Data Engineer'];
  const generate = async (options: any) => {
    const listed = JSON.parse(options.prompt).cargos as Array<{ i: number; cargo: string }>;
    const said: Record<string, string> = { 'Coordinador Gestión Riesgo Incendios': 'none', 'Jefe Prevención de Riesgos': 'similar', 'Corporate Risk Manager': 'related', 'Data Engineer': 'none' };
    return { titles: listed.map((entry) => ({ i: entry.i, match: said[entry.cargo] })) };
  };
  const classes = await classifyTitles(asked, titles, { generate });
  // The model said «none» to the exact one: every asked word is there, so it is exact.
  const ranked = rankByTitle(titles.map((title, index) => ({ id: String(index), title })), classes);
  assert.deepEqual(ranked.map((person) => [person.title, person.title_match]), [
    ['Coordinador Gestión Riesgo Incendios', 'exact'], ['Jefe Prevención de Riesgos', 'similar'], ['Corporate Risk Manager', 'related'],
  ]);
  clearTitleAiCache();
  const fallback = await classifyTitles(asked, titles, { generate: async () => { throw new Error('down'); } });
  assert.deepEqual(rankByTitle(titles.map((title) => ({ title })), fallback).map((person) => person.title), ['Coordinador Gestión Riesgo Incendios']);
});
