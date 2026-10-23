import assert from 'node:assert/strict';
import test from 'node:test';
import { datesInText, namesOf, numbersOf, ungroundedIn } from './research-signal-grounding';

const FACTS = [
  'Auxiliar de Bodega con turnos 6x1 – MalloaEmpresa: Sodexo.Cargo: Auxiliar de Bodega.Ubicación: Malloa, Región de O\'Higgins.Vacantes publicadas: 10.',
  'Sodexo busca coordinadores en Antofagasta y Copiapó con renta de entre $1.800.000 y $1.900.000, hasta el 4 de diciembre.',
];
const company = { companyName: 'Sodexo Chile', companyDomain: 'sodexo.cl' };

test('numbers are compared by their digits, so the separators of a figure do not matter', () => {
  assert.deepEqual(numbersOf('UF 5,4 millones y $185.209,6 millones, 31,5%'), ['54', '1852096', '315']);
  assert.deepEqual(numbersOf('sin cifras'), []);
});

test('names are the capitalised words of four letters or more that are not the first of the text', () => {
  assert.deepEqual(namesOf('Sodexo publicó vacantes en Malloa y Coquimbo para Ayudantes'), ['malloa', 'coquimbo', 'ayudantes']);
  assert.deepEqual(namesOf('Hola Ana'), [], 'the first word is free and «Ana» is shorter than four letters');
});

test('a statement is grounded when its numbers and names are in the facts', () => {
  assert.equal(ungroundedIn('Sodexo Chile publicó 10 vacantes de auxiliar de bodega en Malloa.', FACTS, company), null);
  assert.equal(ungroundedIn('Sodexo Chile busca coordinadores en Antofagasta y Copiapó, con renta de $1.800.000.', FACTS, company), null);
  assert.equal(ungroundedIn('Sodexo Chile publicó 25 vacantes de auxiliar de bodega en Malloa.', FACTS, company), 'number_not_in_facts', '10 and 15 do not make 25');
  assert.equal(ungroundedIn('Sodexo Chile publicó 10 vacantes de auxiliar de bodega en Rancagua.', FACTS, company), 'name_not_in_facts');
});

test('the date of the signal, the company, the months and the countries are free', () => {
  assert.equal(ungroundedIn('El 12 de octubre de 2026 Sodexo Chile publicó 10 vacantes en Malloa, Chile.', FACTS, { ...company, date: '2026-10-12T12:00:00.000Z' }), null);
  assert.equal(ungroundedIn('El 12 de octubre de 2026 Sodexo Chile publicó 10 vacantes en Malloa.', FACTS, company), 'number_not_in_facts', 'without the date of the signal, 12 and 2026 are not in the facts');
});

test('dates in a text are found in the forms a page writes them', () => {
  assert.deepEqual(datesInText('Hasta el 4 de diciembre', 2026), ['2026-12-04']);
  assert.deepEqual(datesInText('Publicado 04/12/2026', 2025), ['2026-12-04']);
});
