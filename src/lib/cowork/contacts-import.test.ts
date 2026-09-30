import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COWORK_IMPORT_LIMIT, coworkContactKeys, coworkGuessImportColumns, coworkImportColumns, coworkImportLabel, coworkImportPlan, coworkImportSummary,
} from './contacts-import';

test('each field is found in the header that says it holds it, the most specific reading first', () => {
  assert.deepEqual(coworkGuessImportColumns(['Nombre', 'Correo electrónico', 'Empresa', 'Cargo', 'LinkedIn', 'Ciudad']),
    { name: 'Nombre', email: 'Correo electrónico', company: 'Empresa', title: 'Cargo', linkedinUrl: 'LinkedIn', location: 'Ciudad' });
  assert.deepEqual(coworkGuessImportColumns(['Full name', 'E-mail', 'Company', 'Job title']),
    { name: 'Full name', email: 'E-mail', company: 'Company', title: 'Job title' });
  // «Nombre de la empresa» is a company, «Correo de contacto» an email; a phone is no field of a contact.
  assert.deepEqual(coworkGuessImportColumns(['Nombre de la empresa', 'Contacto', 'Correo de contacto', 'Teléfono de contacto']),
    { company: 'Nombre de la empresa', name: 'Contacto', email: 'Correo de contacto' });
  assert.deepEqual(coworkGuessImportColumns(['Nombres', 'Apellidos', 'Mail']), { name: 'Nombres', lastName: 'Apellidos', email: 'Mail' });
  // The first header wins; a column that says nothing known is left out.
  assert.deepEqual(coworkGuessImportColumns(['Nombre', 'Nombre (2)', 'Estado', 'Notas']), { name: 'Nombre' });
});

test('the columns the model names win over the guess, in any case or accents, and a name that is not a header is reported', () => {
  const headers = ['Quién', 'Dónde trabaja', 'Correo', 'Nombre'];
  const { columns, unknown } = coworkImportColumns(headers, { name: 'quien', company: 'donde trabaja' });
  assert.deepEqual(columns, { name: 'Quién', company: 'Dónde trabaja', email: 'Correo' }, '«Nombre» is not reused: name was named');
  assert.deepEqual(unknown, []);
  assert.deepEqual(coworkImportColumns(headers, { email: 'Mail', title: null }).unknown, ['Mail']);
  assert.equal(coworkImportColumns(['Nombre', 'Cargo'], { title: null }).columns.title, undefined, 'null leaves a field out');
});

const table = {
  columns: ['Nombre', 'Apellido', 'Correo', 'Empresa', 'Cargo', 'LinkedIn'],
  body: [
    ['Camila', 'Fuentes', 'CFuentes@Adecco.cl', 'Adecco', 'Analista de Selección', 'linkedin.com/in/camila-f'],
    ['Tomás', 'Riquelme', 'mailto:triquelme@walmart.cl; otro@walmart.cl', 'Walmart Chile', 'Jefe de Reclutamiento', 'https://www.linkedin.com/in/tomas-r'],
    ['', '', 'sinnombre@x.cl', 'X', '', ''],
    ['Daniela', 'Soto', 'no-es-un-correo', 'Cencosud', 'HR Business Partner', 'https://malo.example/perfil'],
    ['camila', 'fuentes', 'cfuentes@adecco.cl', 'Adecco', '', ''],
    ['Marcela', 'Rojas', 'mrojas@sodexo.cl', 'Sodexo Chile', 'Gerente de Personas', ''],
    ['Andrés', 'Pizarro', '', 'Sodimac', 'Jefe de Personas', ''],
    ['李', '雷', '', 'Empresa China', '', ''],
  ],
};

test('each row becomes a contact: names joined, emails and LinkedIn checked, and what is saved or repeated left out', () => {
  const columns = coworkGuessImportColumns(table.columns);
  const saved = new Set([...coworkContactKeys({ email: 'mrojas@sodexo.cl' }), ...coworkContactKeys({ name: 'Andres Pizarro', company: 'sodimac' })]);
  const plan = coworkImportPlan(table, columns, saved);
  assert.deepEqual(plan.contacts.map(contact => contact.name), ['Camila Fuentes', 'Tomás Riquelme', 'Daniela Soto', '李 雷']);
  assert.deepEqual(plan.contacts[0], { name: 'Camila Fuentes', email: 'cfuentes@adecco.cl', title: 'Analista de Selección', company: 'Adecco',
    linkedinUrl: 'https://linkedin.com/in/camila-f', location: null });
  assert.equal(plan.contacts[1].email, 'triquelme@walmart.cl', 'the first valid address of the cell');
  assert.equal(plan.contacts[1].linkedinUrl, 'https://www.linkedin.com/in/tomas-r');
  assert.equal(plan.contacts[2].email, null, 'an invalid address is dropped, the contact stays');
  assert.equal(plan.contacts[2].linkedinUrl, null, 'only linkedin.com profiles are kept');
  assert.deepEqual({ total: plan.total, duplicates: plan.duplicates, skipped: plan.skipped, invalidEmails: plan.invalidEmails, overLimit: plan.overLimit },
    { total: 8, duplicates: 3, skipped: 1, invalidEmails: 1, overLimit: 0 },
    'repeated in the file (Camila), saved by email (Marcela) and by name and company without accents (Andrés)');
  assert.ok(coworkContactKeys(plan.contacts[3]).length > 0, 'a name in another alphabet still identifies its contact');
  assert.equal(coworkImportLabel('feria.csv', plan), 'Importar 4 contactos de feria.csv (3 ya estaban)');
  assert.equal(coworkImportLabel('uno.csv', { contacts: [plan.contacts[0]], duplicates: 1 }), 'Importar 1 contacto de uno.csv (1 ya estaba)');
});

test('one import keeps at most its limit, and counts the rest', () => {
  const body = Array.from({ length: COWORK_IMPORT_LIMIT + 20 }, (_, index) => [`Persona ${index}`, `p${index}@empresa.cl`]);
  const plan = coworkImportPlan({ columns: ['Nombre', 'Correo'], body }, { name: 'Nombre', email: 'Correo' }, new Set());
  assert.equal(plan.contacts.length, COWORK_IMPORT_LIMIT);
  assert.equal(plan.overLimit, 20);
  assert.equal(plan.contacts.at(-1)?.name, `Persona ${COWORK_IMPORT_LIMIT - 1}`, 'in the order of the file');
});

test('the card says how many come in, who stays out, the columns and what to know, in the words the person reads', () => {
  assert.deepEqual(coworkImportSummary({ file: 'feria.csv', sheet: null, columns: [{ field: 'name', label: 'Nombre', header: 'Contacto' }],
    count: 1, duplicates: 2, skipped: 1, withoutEmail: 1, overLimit: 0, limit: COWORK_IMPORT_LIMIT }), {
    headline: '1 contacto nuevo', source: 'de feria.csv', leftOut: ['2 ya estaban en tus contactos', '1 fila sin nombre'], columns: ['Nombre ← Contacto'],
    more: null, notes: ['1 contacto no trae correo: se guarda igual, y para escribirle hay que buscar su correo primero.'], approve: 'Importar 1 contacto',
  });
  const big = coworkImportSummary({ file: 'base.xlsx', sheet: 'Prospectos', columns: [], count: 500, duplicates: 1, skipped: 0, withoutEmail: 100, overLimit: 20, limit: 500 });
  assert.equal(`${big.headline} ${big.source}`, '500 contactos nuevos de base.xlsx · hoja Prospectos');
  assert.deepEqual(big.leftOut, ['1 ya estaba en tus contactos']);
  assert.equal(big.more, 'y 492 contactos más');
  assert.deepEqual(big.notes, ['100 contactos no traen correo: se guardan igual, y para escribirles hay que buscar su correo primero.',
    'Se importan los primeros 500; quedan 20 para otra importación.']);
  assert.equal(big.approve, 'Importar 500 contactos');
  // Nothing left out, nothing to note: the card stays short.
  const clean = coworkImportSummary({ file: 'a.csv', sheet: null, columns: [], count: 9, duplicates: 0, skipped: 0, withoutEmail: 0, overLimit: 0, limit: 500 });
  assert.deepEqual([clean.leftOut, clean.notes, clean.more], [[], [], 'y 1 contacto más']);
});
