import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import JSZip from 'jszip';
import { xml2js } from 'xml-js';
import { clampOfferDraft, type OfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import { offerDocx, type OfferDocumentInput } from './offer-docx';

// «Servicio de aseo para dependencias del Museo Histórico Nacional», as the bases and their forms ask for it.
const draft: OfferDraft = {
  summary: 'GrupoExpro, a través de su línea ExproFacility, ofrece al Servicio Nacional del Patrimonio Cultural el servicio de aseo para las dependencias del Museo Histórico Nacional, con una dotación mínima de 5 personas de jornada completa.',
  technical: [
    { heading: 'Dotación y personal asignado', criterion: 'Dotación mínima de 5 personas jornada completa; Anexo N°10 por trabajador', weight: '', body: 'Asignaremos 5 personas de jornada completa a las labores de aseo.\nPresentaremos un Anexo N°10 por cada trabajador, con su función, sueldo líquido, bonos y aguinaldos.\n- Ningún sueldo líquido será inferior a $553.553.\n- Nombres y funciones del personal: [nombres y funciones de los 5 trabajadores].', evidence: [] },
    { heading: 'Experiencia en servicios de aseo', criterion: 'Experiencia acreditada en Anexo N°6', weight: '20 %', body: 'Acreditaremos nuestra experiencia solo con los contratos detallados en el Anexo N°6. N.º de contratos de aseo similares: [N.º de contratos similares].', evidence: [] },
  ],
  compliance: [
    { requirement: 'Dotación mínima de 5 personas de jornada completa', answer: '[confirmar si cumplimos: dotación de 5 personas de jornada completa para aseo]', evidence: [] },
    { requirement: 'Precios invariables y fijos', answer: 'Cumplimos: ofertamos precios invariables y fijos, sin cláusulas de reajuste.', evidence: [] },
    { requirement: 'Oferta económica no superior a $228.000.000 IVA incluido', answer: 'Cumpliremos: nuestra oferta no superará $228.000.000 IVA incluido. [confirmar monto]', evidence: [] },
  ],
  economic: { lines: [{ description: 'Servicios de limpieza de edificios: aseo para dependencias del Museo Histórico Nacional', unit: 'Mes', quantity: 24, notes: '', evidence: [] }],
    priceBasis: 'total', validity: '', paymentTerms: 'Pago dentro de 30 días contados desde el documento tributario.', notes: ['Contrato de 24 meses.', 'Multa por mala o no ejecución: 3 UTM por evento.'] },
  // A letter of the first version, with everything the document now writes itself.
  letter: '[Lugar y fecha]\nSeñores\nServicio Nacional del Patrimonio Cultural\nMuseo Histórico Nacional\nRef.: Licitación pública ID 1217466-29-LP26, «Servicio Aseo para Dependencias del MHN».\n[Razón social], RUT [RUT de la empresa], presenta su oferta para el servicio de aseo de las dependencias del Museo Histórico Nacional. Ofrecemos una dotación de 5 personas de jornada completa, con supervisión programada.\nDeclaramos conocer y aceptar las bases administrativas, técnicas y sus anexos.\nAtentamente,\n[Firma][Nombre del representante legal][RUT del representante legal]',
  missing: ['Razón social y RUT de la empresa', 'Nombre y RUT del representante legal', 'Nombres, funciones y sueldos líquidos de los 5 trabajadores (Anexo N°10)', 'Garantía de seriedad por $200.000, vigente 60 días desde el cierre'],
  annexes: [
    { number: 'Anexo N°1', title: 'Identificación del oferente y aceptación de bases', intro: '', signed: true, faithful: true, blocks: [
      { kind: 'fields', title: 'Identificación del proponente', text: '', fields: [{ label: 'Nombre del proponente o razón social', value: '' }, { label: 'RUT del proponente', value: '' }, { label: 'Domicilio', value: '' }], columns: [], rows: [], blankRows: 0, options: [] },
      { kind: 'text', title: 'Declaración jurada simple', text: 'Yo, [nombre del representante legal], RUT [RUT del representante legal], en representación de [razón social], declaro bajo juramento haber leído las bases, sus anexos, consultas, respuestas y aclaraciones, y no encontrarme afecto a las inhabilidades del artículo 4° de la Ley N°19.886.', fields: [], columns: [], rows: [], blankRows: 0, options: [] }] },
    { number: 'Anexo N°6', title: 'Experiencia del oferente', intro: 'Contratos de aseo similares, desde $20.000.000 IVA incluido.', signed: true, faithful: true, blocks: [
      { kind: 'table', title: '', text: '', fields: [], columns: ['N°', 'Cliente', 'Descripción del servicio', 'Monto (IVA incl.)', 'Año', 'Respaldo'], rows: [], blankRows: 4, options: [] }] },
    { number: 'Anexo N°11', title: 'Servicios adicionales', intro: '', signed: true, faithful: false, blocks: [
      { kind: 'choices', title: '', text: 'Marque al menos un servicio adicional, incluido en el precio.', fields: [], columns: [], rows: [], blankRows: 0, options: ['Lavado de vidrios interiores', 'Desinfección de baños', 'Abrillantado de pisos'] }] },
  ],
};
const input: OfferDocumentInput = {
  saved: { draft: clampOfferDraft(draft), prices: {}, created_at: '2026-10-21T14:00:00Z' },
  opportunity: { title: 'SERVICIO ASEO PARA DEPENDENCIAS DEL MHN', buyer: 'SERVICIO NACIONAL DEL PATRIMONIO CULTURAL', code: '1217466-29-LP26', deadline: '2026-10-22T13:00:00Z', amount: 228000000, budgetIncludesTax: true },
  company: { legalName: 'Grupo Expro SpA', rut: '76.123.456-7' },
  documents: [
    { folder: 'Documentos de la oferta', title: 'Anexo N°1 (identificación del oferente y aceptación de bases)', signed: true, excludesIfMissing: true },
    { folder: 'Documentos de la oferta', title: 'Certificado de habilidad vigente en el Registro de Proveedores', signed: false, excludesIfMissing: false },
  ],
};

async function unzip(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return { zip, document: await zip.file('word/document.xml')!.async('string') };
}
const text = (xml: string) => [...xml.matchAll(/<w:t[ >][^<]*|<w:t>[^<]*/g)].map(m => m[0].replace(/<w:t[^>]*>/, '')).join('');

test('the Word is a valid document: well-formed XML and a content control with its own id each', async () => {
  const bytes = await offerDocx(input);
  if (process.env.OFFER_DOCX_OUT) writeFileSync(process.env.OFFER_DOCX_OUT, bytes);
  const { zip, document } = await unzip(bytes);
  for (const name of ['word/styles.xml', 'word/numbering.xml', '[Content_Types].xml']) {
    const part = zip.file(name);
    assert.ok(part, `${name} is in the file`);
    const xml = await part.async('string');
    assert.doesNotThrow(() => xml2js(xml, { compact: false }), name);
  }
  assert.doesNotThrow(() => xml2js(document, { compact: false }), 'the body is well-formed');
  const ids = [...document.matchAll(/<w:id w:val="(\d+)"\/>/g)].map(match => match[1]);
  assert.ok(ids.length > 20, 'many boxes to fill');
  assert.equal(new Set(ids).size, ids.length, 'no two controls share an id');
  assert.ok(document.includes('<w14:checkbox>'), 'tick boxes');
  assert.ok(document.includes('<w:dropDownList>'), 'a list to say whether each requirement is met');
  assert.ok(document.includes('<w:date>'), 'a date picker');
  assert.ok(document.includes('w:rStyle w:val="Marcador"'), 'the boxes are yellow');
});

test('the work sheet comes first and says what is missing and which documents to hand in; it does not go out', async () => {
  const { document } = await unzip(await offerDocx(input));
  const body = text(document);
  assert.ok(body.indexOf('Hoja de trabajo') < body.indexOf('Carta de presentación'));
  for (const wanted of ['Datos por completar (4)', 'Garantía de seriedad por $200.000', 'Documentos que debe entregar (2)', 'Si falta, queda fuera', 'ID de la licitación', '1217466-29-LP26', 'Presupuesto', '$228.000.000 IVA incluido']) assert.ok(body.includes(wanted), wanted);
});

test('the cover letter writes the date, the addressee, the reference and the closing itself, with the body of the draft in the middle', async () => {
  const { document } = await unzip(await offerDocx(input));
  const body = text(document);
  assert.ok(body.includes('Señores'));
  assert.ok(body.includes('Ref.: Licitación Pública ID 1217466-29-LP26, «SERVICIO ASEO PARA DEPENDENCIAS DEL MHN».'));
  assert.ok(body.includes('Ofrecemos una dotación de 5 personas de jornada completa'));
  assert.equal(body.split('Declaramos conocer y aceptar las bases').length - 1, 1, 'the body is once');
  assert.equal(body.split('Atentamente').length - 1, 1, 'the closing is not repeated from the old letter');
  assert.ok(!body.includes('[Lugar y fecha]'), 'the old place and date line goes away');
});

test('the compliance table has a list per requirement, already on «Sí cumple» where the company said it does', async () => {
  const { document } = await unzip(await offerDocx(input));
  assert.equal(document.split('<w:dropDownList>').length - 1, 3);
  assert.equal(document.split('w:value="Sí cumple"').length - 1, 3, 'each list offers it');
  const body = text(document);
  assert.ok(body.includes('Describa cómo cumple: dotación de 5 personas de jornada completa para aseo'));
  assert.ok(body.includes('Ofertamos precios invariables y fijos'));
  assert.ok(!body.includes('[confirmar si cumplimos'), 'the question is a box, not a sentence in brackets');
});

test('the forms of the bases come after the economic offer, each with its tables, boxes and signature, filled with the company data it has', async () => {
  const { document } = await unzip(await offerDocx(input));
  const body = text(document);
  assert.ok(body.indexOf('Oferta económica') < body.indexOf('Anexo N°1'));
  assert.ok(body.includes('Grupo Expro SpA') && body.includes('76.123.456-7'), 'razón social and RUT from the ficha');
  assert.ok(body.includes('Declaración jurada simple'));
  assert.ok(body.includes('Lavado de vidrios interiores'), 'options to tick');
  assert.ok(body.includes('Formulario armado con lo que piden las bases'), 'a form not found in the bases says so');
  assert.ok(body.includes('Nombre, RUT y firma'));
  assert.equal(document.split('<w14:checkbox>').length - 1 >= 4 + 3, true, 'work sheet boxes plus the three options');
});

test('with no forms and no prices, the economic sheet says where to type them; with prices it adds up', async () => {
  const empty = text((await unzip(await offerDocx({ ...input, saved: { ...input.saved, draft: { ...input.saved.draft, annexes: undefined } } }))).document);
  assert.ok(empty.includes('Escriba los precios en ANTON.IA'));
  assert.ok(!empty.includes('Experiencia del oferente'), 'no form pages');
  const priced = text((await unzip(await offerDocx({ ...input, saved: { ...input.saved, prices: { 0: 8_500_000 } } }))).document);
  assert.ok(priced.includes('$8.500.000') && priced.includes('$204.000.000'), 'unit price and subtotal');
  assert.ok(priced.includes('IVA (19 %)') && priced.includes('Total con IVA'));
  assert.ok(!priced.includes('Escriba los precios en ANTON.IA'));
});

test('a single form is a Word of its own, with no work sheet and no other section', async () => {
  const { document } = await unzip(await offerDocx({ ...input, onlyAnnex: 1 }));
  const body = text(document);
  assert.ok(body.includes('Experiencia del oferente'));
  assert.ok(!body.includes('Hoja de trabajo') && !body.includes('Carta de presentación') && !body.includes('Identificación del oferente y aceptación'));
  assert.ok(body.includes('Cliente') && body.includes('Respaldo'));
});

test('control characters and markup in the data never break the file', async () => {
  const hostile = { ...input, opportunity: { ...input.opportunity, title: 'Aseo <b>"&"</b>\u0000 del museo' }, company: { legalName: 'A & B "SpA" <x>', rut: null } };
  const { document } = await unzip(await offerDocx(hostile));
  assert.doesNotThrow(() => xml2js(document, { compact: false }));
});
