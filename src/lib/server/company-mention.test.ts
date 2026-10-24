import assert from 'node:assert/strict';
import test from 'node:test';
import { companyNames, pageMentionsCompany } from './company-mention';

const page = (text: string, extra: { title?: string; url?: string; ownDomain?: boolean } = {}) => ({
  text, source: { title: extra.title ?? 'Una nota', url: extra.url ?? 'https://prensa.example/nota', ownDomain: extra.ownDomain ?? false },
}) as never;

test('a name is read without its legal form and its country, and the label of the address counts as a name', () => {
  assert.deepEqual(companyNames('Sodexo Chile S.A.', 'sodexo.cl'), { phrases: ['sodexo'], words: [] });
  assert.deepEqual(companyNames('Aguas Andinas', 'www.aguasandinas.cl'), { phrases: ['aguas andinas', 'aguasandinas'], words: [] });
  assert.deepEqual(companyNames('SMU', 'https://smu.cl/'), { phrases: ['smu'], words: [] });
  assert.deepEqual(companyNames('Grupo Falabella', 'falabella.com'), { phrases: ['falabella'], words: [] });
  assert.deepEqual(companyNames('Sociedad Química y Minera de Chile', 'sqm.com'), { phrases: ['quimica minera', 'sqm'], words: [] });
  assert.deepEqual(companyNames('Compañía Minera Doña Inés de Collahuasi SCM', 'collahuasi.cl'), { phrases: ['minera dona ines collahuasi scm', 'collahuasi'], words: ['collahuasi'] });
  assert.deepEqual(companyNames('Mi Empresa', 'miempresa.com.pe'), { phrases: ['miempresa'], words: [] }, 'a word too short to say the name alone is left out, and a second-level domain is read through');
});

test('a page about a namesake is not about the company: Salfa is not SalfaCorp, Besco is not Besalco', () => {
  assert.equal(pageMentionsCompany(page('Salfa abre una nueva sucursal de maquinaria en Antofagasta y vende camiones.'), 'Salfacorp', 'salfacorp.cl'), false);
  assert.equal(pageMentionsCompany(page('SalfaCorp reportó utilidades por $11.000 millones en el semestre.'), 'Salfacorp', 'salfacorp.cl'), true);
  assert.equal(pageMentionsCompany(page('Besco anuncia una inversión en Lima.'), 'Besalco', 'besalco.cl'), false);
  assert.equal(pageMentionsCompany(page('Besalco ganó un contrato de obras viales.'), 'Besalco', 'besalco.cl'), true);
});

test('the name counts whatever its case, its accents or its punctuation, and so does the address of the site', () => {
  assert.equal(pageMentionsCompany(page('AGUAS ANDINAS informó cortes programados.'), 'Aguas Andinas', 'aguasandinas.cl'), true);
  assert.equal(pageMentionsCompany(page('Más información en www.aguasandinas.cl/avisos'), 'Aguas Andinas', 'aguasandinas.cl'), true);
  assert.equal(pageMentionsCompany(page('Resultados', { title: 'Sodexo Chile abre 70 vacantes' }), 'Sodexo Chile', 'sodexo.cl'), true);
  assert.equal(pageMentionsCompany(page('La compañía Compañía Minera Collahuasi informó producción récord.'), 'Compañía Minera Doña Inés de Collahuasi SCM', 'collahuasi.cl'), true);
  assert.equal(pageMentionsCompany(page('Una nota sobre empleo en el rubro de los supermercados.'), 'Aguas Andinas', 'aguasandinas.cl'), false);
});

test('a name inside another word is not the name, and a page of the company\'s own site always is about it', () => {
  assert.equal(pageMentionsCompany(page('El musmu del mercado subió.'), 'SMU', 'smu.cl'), false);
  assert.equal(pageMentionsCompany(page('Aviso de la gerencia.', { ownDomain: true }), 'SMU', 'smu.cl'), true);
});
