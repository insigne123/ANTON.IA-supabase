import assert from 'node:assert/strict';
import test from 'node:test';
import { annexKey, annexOpenFields, clampOfferAnnexes, matchAnnex, offerAnnexesSchema, offerFormExcerpts, type OfferAnnex } from './offer-annexes';

const form = (number: string, title: string, over: Partial<OfferAnnex> = {}): OfferAnnex => ({ number, title, intro: '', signed: true, faithful: true, blocks: [], ...over });
const block = (over: Record<string, unknown>) => ({ kind: 'text', title: '', text: '', fields: [], columns: [], rows: [], blankRows: 0, options: [], ...over }) as OfferAnnex['blocks'][number];

test('the number of an annex reads the way the bases write it, and a word after it is not its letter', () => {
  const key = (title: string) => annexKey(title);
  assert.equal(key('Anexo N°1 (identificación del oferente y aceptación de bases)'), '1');
  assert.equal(key('ANEXO N°2 - OFERTA ECONÓMICA'), '2');
  assert.equal(key('Anexo Nº 3 oferta técnica'), '3');
  assert.equal(key('ANEXO 4 A – NÓMINA DE CLIENTES'), '4a');
  assert.equal(key('Anexo N°4-B'), '4b');
  assert.equal(key('Anexo N° 10 por trabajador'), '10');
  assert.equal(key('Anexo N°4 a la oferta'), '4', '«a la» is a word');
  assert.equal(key('Certificado de habilidad'), null);
});

test('each document of the guide finds its form by number, by family of letters, or by name', () => {
  const annexes = [form('Anexo N°1', 'Identificación del oferente'), form('Anexo 4-A', 'Nómina de clientes'), form('Anexo 4-B', 'Equipo de trabajo'), form('Anexo N°11', 'Servicios adicionales')];
  assert.equal(matchAnnex('Anexo N°1 (identificación del oferente y aceptación de bases)', annexes), 0);
  assert.equal(matchAnnex('Anexo N°4-B equipo', annexes), 2);
  assert.equal(matchAnnex('Anexo N°4', annexes), 1, 'the guide says 4 and the bases split it in 4-A and 4-B: the first answers it');
  assert.equal(matchAnnex('Anexo N°11: servicios adicionales', annexes), 3);
  assert.equal(matchAnnex('Servicios adicionales ofrecidos', annexes), 3, 'by name when the number is missing');
  assert.equal(matchAnnex('Certificado F30', annexes), -1);
  assert.equal(matchAnnex('Anexo N°1', undefined), -1);
  assert.equal(matchAnnex('Anexo N°2', annexes), -1, 'a form that was not written is not guessed');
});

test('the clamp drops empty forms and blocks, bounds the rows and keeps what is written', () => {
  const clamped = clampOfferAnnexes([
    form('  Anexo N°1 ', ' Identificación ', { blocks: [block({ kind: 'fields', fields: [{ label: 'Razón social', value: ' ' }, { label: '  ', value: 'x' }] }), block({ kind: 'text', text: '   ' }), block({ kind: 'table', columns: ['N°', 'Cliente'], blankRows: 99 })] }),
    form('', ''),
  ]);
  assert.equal(clamped.length, 1);
  assert.equal(clamped[0].number, 'Anexo N°1');
  assert.equal(clamped[0].blocks.length, 2, 'the empty text block goes away');
  assert.deepEqual(clamped[0].blocks[0].fields, [{ label: 'Razón social', value: '' }]);
  assert.equal(clamped[0].blocks[1].blankRows, 30);
  assert.equal(offerAnnexesSchema.safeParse({ annexes: [form('Anexo N°1', 'x', { blocks: [block({ kind: 'choices', options: ['Sí', 'No'] })] })], missing: [] }).success, true);
});

test('the fields still to fill count the empty fields, the blank rows and each set of boxes', () => {
  assert.equal(annexOpenFields(form('A', 'B', { blocks: [block({ kind: 'fields', fields: [{ label: 'RUT', value: '76.1' }, { label: 'Domicilio', value: '' }] }), block({ kind: 'table', columns: ['N°'], blankRows: 3 }), block({ kind: 'choices', options: ['SÍ', 'NO'] }), block({ kind: 'text', text: 'Declaro' })] })), 5);
});

test('the forms of the bases are read whole: the files named «Anexo» first, and the annexes pasted in the bases', () => {
  const documents = [{ id: 'b', name: 'BASES ADMINISTRATIVAS.pdf' }, { id: 'a1', name: 'ANEXO N°1 - OFERTA ADM.docx' }, { id: 'c', name: 'Aclaraciones.pdf' }];
  const chunks = [
    { document_id: 'b', ordinal: 1, content: 'Las ofertas se presentan por el portal. Plazo de 30 días.' },
    { document_id: 'b', ordinal: 9, content: 'ANEXO N°5 - FORMULARIO DE INTEGRIDAD. Nombre: ________ Firma del representante legal' },
    { document_id: 'a1', ordinal: 2, content: 'Declaración jurada simple: yo, (nombre representante legal)' },
    { document_id: 'a1', ordinal: 1, content: 'ANEXO N°1 - ANTECEDENTES ADMINISTRATIVOS' },
    { document_id: 'c', ordinal: 1, content: 'Se aclara que el plazo no cambia.' },
  ];
  const excerpts = offerFormExcerpts(chunks, documents);
  assert.deepEqual(excerpts.map(entry => entry.name), ['ANEXO N°1 - OFERTA ADM.docx', 'BASES ADMINISTRATIVAS.pdf']);
  assert.equal(excerpts[0].text, 'ANEXO N°1 - ANTECEDENTES ADMINISTRATIVOS\nDeclaración jurada simple: yo, (nombre representante legal)', 'in reading order');
  assert.ok(excerpts[1].text.includes('FORMULARIO DE INTEGRIDAD') && !excerpts[1].text.includes('Plazo de 30 días'), 'only the chunks that look like a form');
  const bounded = offerFormExcerpts([{ document_id: 'a1', ordinal: 1, content: 'x'.repeat(5000) }], documents, 1000);
  assert.ok(bounded[0].text.length <= 1001, 'bounded to keep the prompt in budget');
});
