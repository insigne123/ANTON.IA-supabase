import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_MIN_RECOMMENDATION, dropMinRecommendation, judgeDropContacts } from './lead-drop-gate';

const criteria = { titles: ['Gerente de Personas'], industries: ['retail'], locations: ['Chile'], sizes: ['201-500'], source: 'perfil' as const };
const seller = { company: 'AXIS', offer: 'Consulta de antecedentes laborales.', services: ['Antecedentes'], sector: 'Software', problems: [] as string[], wants: null as string | null };
const contacts = [
  { leadId: 'a', title: 'Gerente de Personas', company: 'Tiendas del Sur', industry: null, size: 800, place: 'Santiago, Chile', about: 'Cadena de tiendas con 40 locales.', news: 'Abrirá tres tiendas en 2027.' },
  { leadId: 'b', title: 'Fundador', company: 'Asesorías Uno', role: 'refer' as const },
  { leadId: 'c', title: 'Jefa de Selección', company: 'Bodegas Andinas' },
];

test('the judge of a drop: a percentage, a reason and what the company does for each contact, from what the research read', async () => {
  const asked: any[] = [];
  const generate = async (options: any) => {
    asked.push(options);
    return { contactos: [{ i: 0, pct: 91.4, razon: '  Cadena con   dotación propia; decide la contratación. ', rubro: 'Retail' }, { i: 1, pct: 12, razon: null }, { i: 1, pct: 99 }, { i: 7, pct: 80 }] };
  };
  const verdicts = await judgeDropContacts({ contacts, criteria, seller, generate });
  assert.deepEqual([...verdicts!], [
    ['a', { pct: 91, reason: 'Cadena con dotación propia; decide la contratación.', industry: 'Retail' }],
    ['b', { pct: 12, reason: null, industry: null }],
  ], 'rounded and tidied; the first answer for a contact stands, a number nobody has is ignored, and who was skipped has no verdict');
  assert.match(asked[0].systemPrompt, /^Eres quien decide si un contacto vale el tiempo de un vendedor B2B/);
  assert.equal(asked[0].openAiModel, 'claude-haiku-5-5');
  const prompt = JSON.parse(asked[0].prompt);
  assert.deepEqual(prompt.vendedor, { empresa: 'AXIS', oferta: 'Consulta de antecedentes laborales.', servicios: ['Antecedentes'], rubro: 'Software' });
  assert.deepEqual(prompt.cliente_ideal, { cargos: ['Gerente de Personas'], rubros: ['retail'], lugares: ['Chile'], empleados: ['201 a 500'] });
  assert.deepEqual(prompt.contactos[0], { i: 0, cargo: 'Gerente de Personas', empresa: 'Tiendas del Sur', rubro_segun_busqueda: null, empleados: 800, lugar: 'Santiago, Chile',
    que_hace: 'Cadena de tiendas con 40 locales.', ahora: 'Abrirá tres tiendas en 2027.' });
  assert.equal(prompt.contactos[1].puede_derivar, true);
  assert.equal(prompt.contactos[2].que_hace, null, 'nothing researched: the judge is told so, and goes by the name');
  // «En tus palabras» and the problems the profile says it solves reach the judge when there are any.
  await judgeDropContacts({ contacts, criteria, generate, seller: { ...seller, problems: ['Ingresos masivos en temporada alta'], wants: 'Solo cadenas con más de 20 locales; nada de consultoras.', teamWants: ' ' } });
  assert.deepEqual(JSON.parse(asked[1].prompt).vendedor, { empresa: 'AXIS', oferta: 'Consulta de antecedentes laborales.', servicios: ['Antecedentes'], rubro: 'Software',
    problemas_que_resuelve: ['Ingresos masivos en temporada alta'], busca_en_sus_palabras: 'Solo cadenas con más de 20 locales; nada de consultoras.' });
});

test('without the model, or with an answer that cannot be read, nobody is judged', async () => {
  assert.equal(await judgeDropContacts({ contacts, criteria, seller }), null);
  assert.equal(await judgeDropContacts({ contacts: [], criteria, seller, generate: async () => ({ contactos: [] }) }), null);
  assert.equal(await judgeDropContacts({ contacts, criteria, seller, generate: async () => { throw new Error('down'); } }), null);
  assert.equal(await judgeDropContacts({ contacts, criteria, seller, generate: async () => ({ contactos: [{ i: 0, pct: 140 }] }) }), null);
  assert.equal(await judgeDropContacts({ contacts, criteria, seller, generate: async () => ({ people: [] }) }), null);
  assert.equal((await judgeDropContacts({ contacts, criteria: null, seller: null, generate: async () => ({ contactos: [] }) }))!.size, 0);
});

test('the minimum is 60 unless the environment says another one from 0 to 100', () => {
  assert.equal(DEFAULT_MIN_RECOMMENDATION, 60);
  assert.deepEqual([undefined, '', ' ', 'alto', '-5', '101', '0', '75', '82.6'].map(value => dropMinRecommendation({ LEAD_DROPS_MIN_RECOMMENDATION: value })),
    [60, 60, 60, 60, 60, 60, 0, 75, 83]);
});
