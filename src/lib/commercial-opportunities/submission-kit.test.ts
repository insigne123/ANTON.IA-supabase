import assert from 'node:assert/strict';
import test from 'node:test';
import { kitChecklist, kitFacts, offerNumbers, parseAmount, submissionKitSchema, validateSubmissionKit, type SubmissionKit } from './submission-kit';
import { reportItemKey } from './report-marks';

// Dalcahue 4481-22-LP25, as the bases write it.
const chunks = [
  { id: 'c1', document_id: 'd1', locator: 'p. 8', ordinal: 1, content: 'Serán causales de Rechazos de las Ofertas: Si no presentase la oferta, o ésta se presentase de manera incompleta o sin firma de alguno de los siguientes documentos solicitados: Formato Oficial de Oferta Económica' },
  { id: 'c2', document_id: 'd1', locator: 'p. 9', ordinal: 2, content: 'Sueldo líquido mínimo solicitado $ 620.000.- Monto menor a mínimo solicitado queda automáticamente fuera de bases.' },
];
const kit: SubmissionKit = {
  channel: 'portal', channelDetail: 'Mercado Público, en carpetas de anexos administrativos, técnicos y económicos.',
  folders: [
    { name: 'Económicos', documents: [
      { title: 'Anexo 4 Formato Oficial de Oferta Económica', source: 'annex', signed: true, validity: '', excludesIfMissing: true, howTo: 'Neto y total con IVA.', evidence: [{ chunkId: 'c1', quote: 'Formato Oficial de Oferta Económica' }] },
      { title: 'Anexo 3 Presupuesto detallado', source: 'annex', signed: true, validity: '', excludesIfMissing: true, howTo: '', evidence: [{ chunkId: 'c1', quote: 'una frase que no está en las bases' }] },
    ] },
    { name: 'Vacía', documents: [] },
  ],
  rules: [{ text: 'Sueldo líquido de al menos $620.000.', kind: 'minimum', evidence: [{ chunkId: 'c2', quote: 'Sueldo líquido mínimo solicitado $ 620.000' }, { chunkId: 'c9', quote: 'inventada' }] }],
  numbers: { budget: 212000000, budgetLabel: '$212.000.000 impuestos incluidos', currency: 'CLP', budgetIncludesTax: true, portalValue: 'net', notes: [] },
  guarantees: [{ kind: 'Fiel cumplimiento', amount: '5% del valor contratado', validity: 'Plazo del contrato más 60 días hábiles', when: 'A la firma del contrato', payableTo: 'Ilustre Municipalidad de Dalcahue' }],
  afterSubmit: [], inconsistencies: [{ text: 'Las bases hablan de dos carpetas y nombran tres.', question: '¿Se entregan en dos o en tres carpetas?' }],
};

test('only what the bases say leaves the offer out: an uncited claim stays a document, never a cause of rejection', () => {
  assert.equal(submissionKitSchema.safeParse(kit).success, true);
  const checked = validateSubmissionKit(kit, chunks);
  const [offer, budget] = checked.folders[0].documents;
  assert.equal(offer.excludesIfMissing, true);
  assert.equal(budget.excludesIfMissing, false, 'its quote is not in the bases');
  assert.deepEqual(budget.evidence, []);
  assert.deepEqual(checked.rules[0].evidence.map(e => e.chunkId), ['c2']);
  assert.deepEqual(checked.folders.map(f => f.name), ['Económicos'], 'an empty folder is not shown');
});

test('each document is ticked once, under its own key, and the ones that leave the offer out are marked', () => {
  const doubled = { folders: [...kit.folders, { name: 'Otra copia', documents: [kit.folders[0].documents[0]] }] };
  const list = kitChecklist(doubled);
  assert.equal(list.length, 2);
  assert.equal(list[0].key, reportItemKey('document', 'Anexo 4 Formato Oficial de Oferta Económica'));
  assert.match(list[0].key, /^doc:[a-f0-9]{16}$/);
  assert.equal(list[0].critical, true);
  assert.deepEqual(kitChecklist(null), []);
});

test('the net value, the VAT and the total agree from either side, and the budget says whether the offer fits', () => {
  assert.deepEqual(offerNumbers({ net: 178_000_000, budget: 212_000_000, budgetIncludesTax: true }), { net: 178_000_000, tax: 33_820_000, total: 211_820_000, budget: 212_000_000, overBudget: false, margin: 180_000 });
  const over = offerNumbers({ total: 214_200_000, budget: 212_000_000, budgetIncludesTax: true })!;
  assert.equal(over.net, 180_000_000);
  assert.equal(over.overBudget, true);
  // A budget written without taxes is compared with the net value.
  assert.equal(offerNumbers({ net: 400, budget: 400, budgetIncludesTax: false })!.overBudget, false);
  assert.equal(offerNumbers({ net: 0 }), null);
  assert.equal(offerNumbers({ net: 1000 })!.budget, null);
});

test('amounts as people type them in Chile', () => {
  assert.equal(parseAmount('212.000.000'), 212_000_000);
  assert.equal(parseAmount('$ 620.000'), 620_000);
  assert.equal(parseAmount('1.500.000,50'), 1_500_000.5);
  assert.equal(parseAmount('400'), 400);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('abc'), null);
});

test('the guide reads the facts with their first citation, within one small call', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ text: `Requisito ${i} `.repeat(60), state: 'documented', citations: [{ chunkId: `c${i}`, quote: 'cita '.repeat(100) }] }));
  const kept = kitFacts(many);
  assert.ok(kept.length < many.length);
  assert.ok(JSON.stringify(kept).length < 75_000);
  assert.equal(kept[0].cita?.chunkId, 'c0');
  assert.ok(kept[0].cita!.quote.length <= 240);
  assert.equal(kitFacts([{ text: 'Sin cita', state: 'unknown' }])[0].cita, undefined);
});

test('a long answer keeps the guide: texts are clipped and lists bounded for the page', async () => {
  const { clampSubmissionKit } = await import('./submission-kit');
  const long = 'Pedir el certificado en la Dirección del Trabajo. '.repeat(30);
  const wide = { ...kit, channelDetail: long, folders: [{ name: 'Administrativos', documents: Array.from({ length: 45 }, (_, i) => ({ ...kit.folders[0].documents[0], title: `Anexo ${i}`, howTo: long })) }] };
  assert.equal(submissionKitSchema.safeParse(wide).success, true, 'the model may write long');
  const shown = clampSubmissionKit(wide);
  assert.ok(shown.channelDetail.length <= 400 && shown.channelDetail.endsWith('…'));
  assert.equal(shown.folders[0].documents.length, 30);
  assert.ok(shown.folders[0].documents.every(doc => doc.howTo.length <= 400));
});

test('the guide speaks of the bases, not of how it was made, and does not restate the closing date as a rule', async () => {
  const { clampSubmissionKit } = await import('./submission-kit');
  const old = { ...kit, channelDetail: 'Portal ChileCompra; los hechos no precisan el nombre de la plataforma de carga ni cómo separar los archivos.',
    rules: [...kit.rules, { text: 'La fecha límite consignada es el 5 de noviembre de 2026 a las 18:00; no se reciben ofertas después.', kind: 'deadline' as const, evidence: [] },
      { text: 'Las muestras se entregan hasta el 3 de noviembre en la oficina de partes.', kind: 'deadline' as const, evidence: [] }] };
  const shown = clampSubmissionKit(old);
  assert.equal(shown.channelDetail, 'Portal ChileCompra.');
  assert.deepEqual(shown.rules.map(rule => rule.kind), ['minimum', 'deadline'], 'another date that leaves the offer out stays');
  assert.equal(clampSubmissionKit(kit).channelDetail, kit.channelDetail);
});
