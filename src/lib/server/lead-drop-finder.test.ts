import assert from 'node:assert/strict';
import test from 'node:test';

import type { DropCandidate, DropCriteria } from '@/lib/lead-drops';
import { dropLessons, dropWishes, finderSearchTerms, scoreDropCandidates } from './lead-drop-finder';
import { clearTitleAiCache } from './search/title-ai';

const criteria: DropCriteria = { titles: ['Jefe de Prevención de Riesgos'], industries: ['minería'], locations: ['Chile'], sizes: [], source: 'perfil' };
const candidate = (n: number, title: string, company: string, extra: Partial<DropCandidate> = {}): DropCandidate => ({
  leadId: `6accdbfcd5f5d80001cf69${String(n).padStart(2, '0')}`, name: `Persona ${n}`, title, company, domain: `${company.toLowerCase()}.cl`, industry: 'Minería', size: 800,
  city: 'Antofagasta', country: 'Chile', hasEmail: true, hasPhone: false, emailKey: null, linkedinKey: null, about: `${company} opera faenas en el norte.`, ...extra,
});
/** A model that classifies by a table and scores by another; everything it was asked is kept. */
const model = (classes: Record<string, string>, notes: Record<string, [number, number] | [number, number, number]>) => {
  const asked: any[] = [];
  const generate = async (options: any) => {
    const prompt = JSON.parse(options.prompt);
    asked.push({ system: String(options.systemPrompt), prompt, model: options.openAiModel });
    if (prompt.cargoBuscado) return { titles: prompt.cargos.map((entry: any) => ({ i: entry.i, match: classes[entry.cargo] ?? 'none' })) };
    if (prompt.personas) return { people: prompt.personas.flatMap((entry: any) => notes[entry.empresa] ? [{ i: entry.i, cargo: notes[entry.empresa][0], empresa: notes[entry.empresa][1], ...(notes[entry.empresa][2] !== undefined ? { deriva: notes[entry.empresa][2] } : {}) }] : []) };
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

test('who works in the area without deciding is kept as the way in, and what the person wrote and asked for reaches the score', async () => {
  // 16 Nov 2026, the owner: «les das leads que tienen cargos muy altos… dales también leads que podrían referirlos con la persona indicada»,
  // and «que estas búsquedas se adapten al usuario»: their own words in «Perfil» and what they ask for when rating a contact.
  clearTitleAiCache();
  const pool = [
    candidate(1, 'Jefe de Prevención de Riesgos', 'Andina'), candidate(2, 'Ingeniero de Prevención de Riesgos', 'Cobre'),
    candidate(3, 'Analista de Prevención de Riesgos', 'Litio'), candidate(4, 'Asistente de Prevención de Riesgos', 'Salar'),
  ];
  const { generate, asked } = model(
    { 'Ingeniero de Prevención de Riesgos': 'similar', 'Analista de Prevención de Riesgos': 'similar', 'Asistente de Prevención de Riesgos': 'similar' },
    // role, company, and how well they could refer: a head who decides, an engineer of the area, an analyst who could not, an assistant with a low role but a good way in.
    { Andina: [9, 9, 9], Cobre: [5, 9, 9], Litio: [4, 8, 3], Salar: [2, 8, 7] },
  );
  const scores = await scoreDropCandidates({
    candidates: pool, criteria, generate, seller: { company: 'Extintores del Norte', offer: 'Sistemas contra incendios.', services: [], differentiators: [], sector: null },
    preferences: { notes: 'Vendo a faenas medianas del norte. No me sirven proveedores.', teamNotes: 'El equipo vende detección y extinción a minería.', wishes: ['Jefaturas de turno', 'Sin consultoras'] },
  });
  assert.deepEqual([...scores].map(([id, score]) => [id.slice(-2), score.role ?? 'decide', score.score]), [
    ['01', 'decide', 92], // 20 + 9 × 4.5 + 9 × 3.5: whoever decides stays as such, whatever they could refer
    ['02', 'refer', 88], // 16 + 9 × 4.5 (the way in, not the role) + 9 × 3.5
    ['03', 'decide', 62], // neither decides nor refers: kept low, as before
    ['04', 'refer', 76], // a role that alone would be left out (2) is kept because it is a good way in
  ]);
  const scoring = asked.find(call => call.prompt.personas);
  assert.deepEqual(scoring.prompt.en_sus_palabras, { vendedor: 'Vendo a faenas medianas del norte. No me sirven proveedores.', equipo: 'El equipo vende detección y extinción a minería.' });
  assert.deepEqual(scoring.prompt.pedidos, ['Jefaturas de turno', 'Sin consultoras']);
  assert.match(scoring.system, /«deriva»: cuánto sirve esa persona como puerta de entrada/);
  assert.match(scoring.system, /Si viene «en_sus_palabras»[\s\S]*mandan sobre las listas/);
  // Without words or wishes the prompt is as before: nothing empty is sent.
  clearTitleAiCache();
  const plain = model({}, { Andina: [9, 9] });
  await scoreDropCandidates({ candidates: [pool[0]], criteria, generate: plain.generate, seller: null });
  const sent = plain.asked.find(call => call.prompt.personas).prompt;
  assert.ok(!('en_sus_palabras' in sent) && !('pedidos' in sent));
});

test('what a person asked for when rating their contacts: theirs alone, newest first, each once', () => {
  const rated = (userId: string, wish: string | null, at: string) => ({ user_id: userId, items: [{ leadId: 'x', title: 'Jefe', feedback: { useful: false, ...(wish ? { wish } : {}), at } }] });
  const rows = [rated('ana', 'Mineras medianas', '2026-11-10T10:00:00Z'), rated('leo', 'Solo retail', '2026-11-12T10:00:00Z'), rated('ana', 'Sin proveedores', '2026-11-14T10:00:00Z'),
    rated('ana', 'mineras medianas', '2026-11-15T10:00:00Z'), rated('ana', null, '2026-11-16T10:00:00Z')];
  assert.deepEqual(dropWishes(rows, 'ana'), ['mineras medianas', 'Sin proveedores']);
  assert.deepEqual(dropWishes(rows, 'leo'), ['Solo retail']);
  assert.deepEqual(dropWishes(rows, 'otra'), []);
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
