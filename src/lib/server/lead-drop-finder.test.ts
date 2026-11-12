import assert from 'node:assert/strict';
import test from 'node:test';

import type { DropCandidate, DropCriteria } from '@/lib/lead-drops';
import { dropLessons, finderSearchTerms, scoreDropCandidates } from './lead-drop-finder';
import { clearTitleAiCache } from './search/title-ai';

const criteria: DropCriteria = { titles: ['Jefe de Prevención de Riesgos'], industries: ['minería'], locations: ['Chile'], sizes: [], source: 'perfil' };
const candidate = (n: number, title: string, company: string, extra: Partial<DropCandidate> = {}): DropCandidate => ({
  leadId: `6accdbfcd5f5d80001cf69${String(n).padStart(2, '0')}`, name: `Persona ${n}`, title, company, domain: `${company.toLowerCase()}.cl`, industry: 'Minería', size: 800,
  city: 'Antofagasta', country: 'Chile', hasEmail: true, hasPhone: false, emailKey: null, linkedinKey: null, about: `${company} opera faenas en el norte.`, ...extra,
});
/** A model that classifies by a table and scores by another; everything it was asked is kept. */
const model = (classes: Record<string, string>, notes: Record<string, [number, number]>) => {
  const asked: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt);
    asked.push({ system: String(options.systemPrompt), prompt, model: options.openAiModel });
    if (prompt.cargoBuscado) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, match: classes[entry.cargo] ?? 'none' })) };
    if (prompt.personas) return { people: prompt.personas.flatMap((entry: any) => notes[entry.empresa] ? [{ i: entry.i, cargo: notes[entry.empresa][0], empresa: notes[entry.empresa][1] }] : []) };
    if (prompt.cargos) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, variants: ['Jefa de Prevención de Riesgos', 'Encargado de Prevención de Riesgos'], keywords: ['prevención', 'prevencion', 'riesgos', 'gerente'] })) };
    throw new Error('unexpected call');
  };
  return { generate, asked };
};

test('each candidate is scored on its role and its company for what the team sells; a title or a company that has nothing to do is left out', async () => {
  clearTitleAiCache();
  const pool = [
    candidate(1, 'Jefe de Prevención de Riesgos', 'Andina'), candidate(2, 'Prevencionista de Riesgos Senior', 'Cobre'), candidate(3, 'Gerente de Operaciones', 'Litio'),
    candidate(4, 'Diseñador Gráfico', 'Salar'), candidate(5, 'Experto en Prevención de Riesgos', 'Panadería'), candidate(6, 'Jefa de Seguridad y Salud Ocupacional', 'Sinnota'),
    candidate(7, 'Jefe de Prevención de Riesgos Financieros', 'Banco'),
  ];
  const { generate, asked } = model(
    { 'Prevencionista de Riesgos Senior': 'similar', 'Gerente de Operaciones': 'related', 'Experto en Prevención de Riesgos': 'similar', 'Jefa de Seguridad y Salud Ocupacional': 'similar' },
    { Andina: [10, 10], Cobre: [8, 9], Litio: [6, 7], Panadería: [8, 0], Banco: [2, 6] },
  );
  const scores = await scoreDropCandidates({
    candidates: pool, criteria, generate,
    seller: { company: 'Extintores del Norte', offer: 'Sistemas contra incendios para faenas mineras.', services: ['Detección', 'Extinción'], differentiators: [], sector: 'Seguridad industrial' },
    lessons: { liked: ['Jefe de Prevención de Riesgos · Minería'], disliked: ['Jefe de Bodega · Retail (no decide)'] },
  });
  assert.deepEqual([...scores].map(([id, score]) => [id.slice(-2), score.titleClass, score.score]), [
    ['01', 'exact', 100], // 20 for the class, 10 × 4.5 for the role and 10 × 3.5 for the company
    ['02', 'similar', 84],
    ['06', 'similar', 56], // the model said nothing of this one: its class and the middle of the scale
    ['03', 'related', 60],
  ], 'not the designer (no relation), nor the bakery (a company that would not buy it), nor the bank\'s financial risk (the words of the role, another job)');
  const scoring = asked.find(call => call.prompt.personas);
  assert.equal(scoring.model, 'claude-haiku-5-5');
  assert.equal(scoring.prompt.vendedor.oferta, 'Sistemas contra incendios para faenas mineras.');
  assert.deepEqual(scoring.prompt.aprendizaje, { le_sirvieron: ['Jefe de Prevención de Riesgos · Minería'], descarto: ['Jefe de Bodega · Retail (no decide)'] });
  assert.deepEqual(scoring.prompt.personas.map((entry: any) => entry.cargo), ['Jefe de Prevención de Riesgos', 'Jefe de Prevención de Riesgos Financieros', 'Prevencionista de Riesgos Senior',
    'Experto en Prevención de Riesgos', 'Jefa de Seguridad y Salud Ocupacional', 'Gerente de Operaciones'], 'the closest titles first, nobody whose title has nothing to do');
  assert.ok(!JSON.stringify(scoring.prompt).includes('Persona 1'), 'the model scores roles and companies: no names');
});

test('with the model down, the titles it can tell by their words still get a score, so the drop is made', async () => {
  clearTitleAiCache();
  const scores = await scoreDropCandidates({
    candidates: [candidate(1, 'Jefa de Prevención de Riesgos', 'Andina'), candidate(2, 'Diseñador Gráfico', 'Salar')], criteria, seller: null,
    generate: async () => { throw new Error('down'); },
  });
  assert.deepEqual([...scores.values()], [{ titleClass: 'exact', score: 60 }]);
});

test('the extra searches: the customer\'s roles as people write them and the words of their area, never the role itself again', async () => {
  clearTitleAiCache();
  const { generate } = model({}, {});
  assert.deepEqual(await finderSearchTerms(criteria, generate), {
    titles: ['Jefa de Prevención de Riesgos', 'Encargado de Prevención de Riesgos'], keywords: ['prevención', 'prevencion', 'riesgos'],
  });
  assert.deepEqual(await finderSearchTerms({ ...criteria, titles: [] }, generate), { titles: [], keywords: [] });
});

test('what the team did with earlier contacts: saved or marked useful, and marked not useful with its reason', () => {
  const item = (title: string, industry: string, extra: Record<string, unknown> = {}) => ({ leadId: 'x', name: 'N', title, industry, ...extra });
  const lessons = dropLessons([
    { items: [item('Jefe de Prevención de Riesgos', 'Minería', { savedLeadId: 's-1' }), item('Gerente de Operaciones', 'Minería', { feedback: { useful: false, reason: 'no ve seguridad', at: '2026-11-10' } })] },
    { items: [item('Jefe de Prevención de Riesgos', 'Minería', { feedback: { useful: true, at: '2026-11-11' } }), item('Jefe de Mantención', 'Energía', { keptLeadId: 'k-1' }), item('Analista', 'Banca')] },
    { items: null },
  ]);
  assert.deepEqual(lessons, {
    liked: ['Jefe de Prevención de Riesgos · Minería', 'Jefe de Mantención · Energía'],
    disliked: ['Gerente de Operaciones · Minería (no ve seguridad)'],
  }, 'the most repeated first; a contact nobody touched teaches nothing');
});
