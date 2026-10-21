import assert from 'node:assert/strict';
import test from 'node:test';
import { complianceAnswer, letterBody, offerParagraphs, prefillField, splitPlaceholders } from './offer-document';

test('the letter keeps its body: what the document writes itself (place, addressee, reference, greeting, closing, signature) goes away', () => {
  const old = '[Lugar y fecha]\nSeñores\nServicio Nacional del Patrimonio Cultural\nMuseo Histórico Nacional\nRef.: Licitación pública ID 1217466-29-LP26, «Servicio Aseo».\n[Razón social], RUT [RUT], presenta su oferta para el servicio de aseo de las dependencias del Museo.\nDeclaramos conocer y aceptar las bases administrativas, técnicas y sus anexos.\nAtentamente,\n[Firma][Nombre del representante legal][RUT del representante legal]';
  assert.deepEqual(letterBody(old), ['[Razón social], RUT [RUT], presenta su oferta para el servicio de aseo de las dependencias del Museo.', 'Declaramos conocer y aceptar las bases administrativas, técnicas y sus anexos.']);
  // A letter written as only a body stays as it is.
  assert.deepEqual(letterBody('Presentamos nuestra oferta para el servicio licitado, con la dotación y la supervisión que piden las bases.\n\nDeclaramos conocer y aceptar las bases y sus anexos completos.'),
    ['Presentamos nuestra oferta para el servicio licitado, con la dotación y la supervisión que piden las bases.', 'Declaramos conocer y aceptar las bases y sus anexos completos.']);
  assert.deepEqual(letterBody(''), []);
  assert.doesNotThrow(() => letterBody('Señores\nAtentamente,'), 'a letter with no body never crashes');
});

test('«Cumplimos: …» is a yes with its how, «[confirmar si cumplimos: …]» is a question left to the company', () => {
  assert.deepEqual(complianceAnswer('Cumplimos: ofertamos precios fijos.'), { choice: 'yes', text: 'Ofertamos precios fijos.', hint: '' });
  assert.deepEqual(complianceAnswer('Cumpliremos: nuestra oferta no superará el presupuesto. [confirmar monto]'), { choice: 'yes', text: 'Nuestra oferta no superará el presupuesto. [confirmar monto]', hint: '' });
  assert.deepEqual(complianceAnswer('[confirmar si cumplimos: dotación de 5 personas]'), { choice: null, text: '', hint: 'dotación de 5 personas' });
  assert.deepEqual(complianceAnswer('Nuestra empresa cuenta con ISO 9001.'), { choice: null, text: 'Nuestra empresa cuenta con ISO 9001.', hint: '' });
  assert.deepEqual(complianceAnswer('Cumplimos'), { choice: 'yes', text: '', hint: '' });
});

test('placeholders split from the text around them, and bullets from paragraphs', () => {
  assert.deepEqual(splitPlaceholders('RUT [RUT de la empresa], domicilio [dirección].'), [{ text: 'RUT ', placeholder: false }, { text: '[RUT de la empresa]', placeholder: true }, { text: ', domicilio ', placeholder: false }, { text: '[dirección]', placeholder: true }, { text: '.', placeholder: false }]);
  assert.deepEqual(splitPlaceholders(''), []);
  assert.deepEqual(offerParagraphs('Primero.\n\n- Uno\n• Dos\n  \nFin.'), [{ kind: 'p', text: 'Primero.' }, { kind: 'li', text: 'Uno' }, { kind: 'li', text: 'Dos' }, { kind: 'p', text: 'Fin.' }]);
});

test('a form field takes only what the company said of itself: its name and its RUT, never the representative or the contact', () => {
  const company = { legalName: 'Grupo Expro SpA', rut: '76.123.456-7' };
  assert.equal(prefillField('Nombre del proponente (persona natural) o razón social', company), 'Grupo Expro SpA');
  assert.equal(prefillField('Razón social', company), 'Grupo Expro SpA');
  assert.equal(prefillField('RUT del proponente', company), '76.123.456-7');
  assert.equal(prefillField('Rut', company), '76.123.456-7');
  for (const label of ['Nombre', 'RUT del representante legal', 'Nombre del representante legal', 'Domicilio', 'Correo/Teléfono', 'Nombre del encargado técnico del contrato', 'Cargo']) assert.equal(prefillField(label, company), null, label);
  assert.equal(prefillField('Razón social', { legalName: null, rut: null }), null);
});
