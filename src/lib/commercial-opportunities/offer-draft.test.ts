import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanOfferPrices, clampOfferDraft, companyProfileExtras, offerDraftChunkIds, offerDraftMarkdown, offerDraftPrompt, offerDraftSchema, offerFacts, offerPlaceholders,
  offerPrice, offerSheet, officialTenderItems, validateOfferDraft, type OfferDraft,
} from './offer-draft';
import type { OpportunityReport } from './expedient';

// «Servicio de aseo Hospital de Castro», as bases of that kind write it.
const chunks = [
  { id: 'c1', document_id: 'd1', locator: 'p. 12', ordinal: 1, content: 'Criterios de evaluación: Experiencia del oferente 40%; Plan de trabajo 30%; Precio 30%.' },
  { id: 'c2', document_id: 'd1', locator: 'p. 14', ordinal: 2, content: 'El oferente deberá contar con una dotación mínima de 12 auxiliares de aseo en turnos de lunes a domingo.' },
];
const draft: OfferDraft = {
  summary: 'Ofrecemos el servicio de aseo integral del Hospital de Castro con [N.º de años] de experiencia en recintos de salud.',
  technical: [
    { heading: 'Experiencia', criterion: 'Experiencia del oferente', weight: '40 %', body: 'Hemos prestado servicios a [clientes del sector salud].', evidence: [{ chunkId: 'c1', quote: 'Experiencia del oferente 40%' }] },
    { heading: 'Plan de trabajo', criterion: 'Plan de trabajo', weight: '30 %', body: 'Turnos de lunes a domingo con 12 auxiliares.', evidence: [{ chunkId: 'c9', quote: 'una cita que no existe en las bases' }] },
    { heading: 'Vacía', criterion: '', weight: '', body: '   ', evidence: [] },
  ],
  compliance: [{ requirement: 'Dotación mínima de 12 auxiliares', answer: 'Cumplimos: [nombre del supervisor] coordina 12 auxiliares.', evidence: [{ chunkId: 'c2', quote: 'dotación mínima de 12 auxiliares de aseo' }] }],
  economic: {
    lines: [
      { description: 'Servicio de aseo mensual', unit: 'mes', quantity: 24, notes: 'Incluye insumos', evidence: [] },
      { description: 'Aseo terminal de pabellones', unit: 'servicio', quantity: null, notes: '', evidence: [] },
      { description: '   ', unit: '', quantity: 1, notes: '', evidence: [] },
    ],
    priceBasis: 'net', validity: '90 días corridos', paymentTerms: '30 días desde la factura', notes: ['Reajuste anual por IPC'],
  },
  letter: 'Señores Hospital de Castro: [nombre de la empresa], RUT [RUT], presenta su oferta.',
  missing: ['RUT de la empresa', 'RUT de la empresa', 'Certificado F30 vigente'],
};

test('the schema takes a full draft', () => {
  assert.equal(offerDraftSchema.safeParse(draft).success, true);
});

test('the clamp drops empty sections and lines, and repeated missing data', () => {
  const clamped = clampOfferDraft(draft);
  assert.deepEqual(clamped.technical.map(s => s.heading), ['Experiencia', 'Plan de trabajo']);
  assert.equal(clamped.economic.lines.length, 2);
  assert.deepEqual(clamped.missing, ['RUT de la empresa', 'Certificado F30 vigente']);
});

test('only the citations that are in the documents stay', () => {
  const valid = validateOfferDraft(draft, chunks);
  assert.equal(valid.technical[0].evidence.length, 1);
  assert.equal(valid.technical[1].evidence.length, 0, 'an invented quote goes away');
  assert.equal(valid.compliance[0].evidence.length, 1);
  assert.deepEqual(offerDraftChunkIds(draft).sort(), ['c1', 'c2', 'c9']);
});

test('the official lines of Mercado Público read with their quantity and unit', () => {
  const items = officialTenderItems({ Items: { Listado: [
    { NombreProducto: 'Servicios de limpieza', Descripcion: 'Aseo hospital 24 meses', UnidadMedida: 'Mes', Cantidad: 24 },
    { NombreProducto: '', Descripcion: '', Cantidad: 1 },
    { NombreProducto: 'Insumos', Descripcion: 'Insumos', UnidadMedida: 'Global', Cantidad: 'x' },
  ] } });
  assert.deepEqual(items, [
    { description: 'Servicios de limpieza: Aseo hospital 24 meses', unit: 'Mes', quantity: 24 },
    { description: 'Insumos', unit: 'Global', quantity: null },
  ]);
  assert.deepEqual(officialTenderItems(null), []);
});

test('what the company said of itself in «Perfil» comes in, whatever its casing', () => {
  assert.deepEqual(companyProfileExtras({ proof_points: 'Atendemos 14 hospitales', referenceClients: ['Hospital de Puerto Montt', 'Clínica Alemana'], valueProposition: '' }),
    { 'Pruebas y resultados': 'Atendemos 14 hospitales', 'Clientes que se pueden nombrar': 'Hospital de Puerto Montt; Clínica Alemana' });
  assert.deepEqual(companyProfileExtras(null), {});
  assert.deepEqual(companyProfileExtras(['x']), {});
});

const report = {
  title: 'Aseo Hospital de Castro', executive: 'Conviene postular.', recommendation: 'advance', reasons: [],
  sections: [
    { id: 'contexto', title: 'Contexto', paragraphs: [], facts: [{ text: 'El hospital atiende a la provincia de Chiloé.', state: 'documented', citations: [] }] },
    { id: 'evaluacion', title: 'Evaluación', paragraphs: [], facts: [{ text: 'Criterios: experiencia 40 %, plan de trabajo 30 %, precio 30 %.', state: 'documented', citations: [{ chunkId: 'c1', quote: 'Experiencia del oferente 40%' }] }] },
  ],
  requirements: [{ title: 'Dotación mínima de 12 auxiliares', status: 'pending', evidence: [], action: 'Confirmar la dotación', role: '', due: '' }],
  tasks: [], milestones: [], risks: [], scenarios: [], questions: [], warnings: [], generatedAt: '2026-10-17T12:00:00Z', coverage: [], sources: [],
} as unknown as OpportunityReport;

test('the facts of the evaluation go first and keep their citation', () => {
  const facts = offerFacts(report);
  assert.equal(facts[0].text, 'Criterios: experiencia 40 %, plan de trabajo 30 %, precio 30 %.');
  assert.deepEqual(facts[0].cita, { chunkId: 'c1', quote: 'Experiencia del oferente 40%' });
  assert.equal(facts[1].cita, undefined);
});

test('the prompt forbids invented data and carries the official lines and the team indications', () => {
  const prompt = offerDraftPrompt({ opportunity: { title: 'Aseo Hospital de Castro', buyer: 'Hospital de Castro', code: '1057-12-LP26', deadline: null, amount: 212000000, currency: 'CLP' },
    company: { offer: 'Servicios de aseo hospitalario', services: ['Aseo'], territories: ['Los Lagos'], exclusions: [], extras: { 'Pruebas y resultados': 'Atendemos 14 hospitales' } },
    report, officialItems: [{ description: 'Servicios de limpieza', unit: 'Mes', quantity: 24 }], instructions: 'Destaca que estamos en Castro' });
  assert.ok(prompt.includes('Nunca inventes experiencia'));
  assert.ok(prompt.includes('"id":"1057-12-LP26"'));
  assert.ok(prompt.includes('Atendemos 14 hospitales'));
  assert.ok(prompt.includes('"quantity":24'));
  assert.ok(prompt.includes('Indicaciones del equipo para esta versión: Destaca que estamos en Castro'));
});

test('prices read the Chilean way; zero is a price, and only existing lines keep theirs', () => {
  assert.equal(offerPrice('$ 1.500.000'), 1500000);
  assert.equal(offerPrice('1.500,50'), 1500.5);
  assert.equal(offerPrice('0'), 0);
  assert.equal(offerPrice(''), null);
  assert.equal(offerPrice(-3), null);
  assert.deepEqual(cleanOfferPrices({ 0: '8.500.000', 1: 'abc', 5: '10', '-1': '3', x: '4' }, 2), { 0: 8500000 });
});

test('the sheet multiplies by the quantity, adds VAT and compares with the budget', () => {
  const clamped = clampOfferDraft(draft);
  const sheet = offerSheet(clamped, { 0: 8000000, 1: 500000 }, { amount: 212000000, includesTax: true });
  assert.deepEqual(sheet.rows.map(row => row.subtotal), [192000000, 500000], 'a line without a quantity counts once');
  assert.equal(sheet.complete, true);
  assert.deepEqual([sheet.numbers!.net, sheet.numbers!.tax, sheet.numbers!.total], [192500000, 36575000, 229075000]);
  assert.equal(sheet.numbers!.overBudget, true, 'the total with VAT is over a budget with taxes included');
  const partial = offerSheet(clamped, { 0: 1000 }, { amount: null, includesTax: null });
  assert.equal(partial.complete, false); assert.equal(partial.priced, 1); assert.equal(partial.numbers!.budget, null);
  assert.equal(offerSheet(clamped, {}, { amount: null, includesTax: null }).numbers, null);
  // When the portal takes the total with VAT, the prices typed already carry it.
  const gross = offerSheet({ economic: { ...clamped.economic, priceBasis: 'total' } }, { 0: 119, 1: 0 }, { amount: null, includesTax: null });
  assert.deepEqual([gross.numbers!.net, gross.numbers!.total], [2400, 2856]);
});

test('the Word version carries the letter, the sections, the sheet with totals and what is missing', () => {
  const markdown = offerDraftMarkdown({ draft: clampOfferDraft(draft), prices: { 0: 8000000 }, created_at: '2026-10-17T12:00:00Z' },
    { title: 'Aseo Hospital de Castro', buyer: 'Hospital de Castro', amount: 212000000, budgetIncludesTax: true });
  assert.ok(markdown.startsWith('# Borrador de oferta: Aseo Hospital de Castro'));
  assert.ok(markdown.includes('## Datos que faltan\n- RUT de la empresa'));
  assert.ok(markdown.includes('### Experiencia\n*Responde a: Experiencia del oferente (40 %)*'));
  assert.ok(markdown.includes('| Servicio de aseo mensual | mes | 24 | $8.000.000 | $192.000.000 |'));
  assert.ok(markdown.includes('| Aseo terminal de pabellones | servicio | — | [precio] | — |'));
  assert.ok(markdown.includes('**Neto:** $192.000.000'));
  assert.ok(markdown.includes('Faltan precios en 1 línea'));
  assert.ok(markdown.includes('- Vigencia de la oferta: 90 días corridos'));
});

test('the placeholders to fill in are counted once', () => {
  assert.deepEqual(offerPlaceholders(clampOfferDraft(draft)).sort(), ['[N.º de años]', '[RUT]', '[clientes del sector salud]', '[nombre de la empresa]', '[nombre del supervisor]'].sort());
});
