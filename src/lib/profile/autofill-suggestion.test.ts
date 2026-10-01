import test from 'node:test';
import assert from 'node:assert/strict';

import { autofillEmptyMessage, suggestionFromAutofill } from './autofill-suggestion';

test('the AI answer becomes form text: offer items one per line, names separated by commas', () => {
  const suggestion = suggestionFromAutofill({
    companyName: 'Acme', sector: 'Outsourcing', website: 'https://acme.cl', domain: 'acme.cl', description: 'D',
    services: ['Transitorios: personal temporal', 'Outsourcing: procesos'], valueProposition: 'V',
    painPoints: ['Rotación'], differentiators: ['ISO 9001', 'Cobertura'], proofPoints: ['30 años'], referenceClients: ['Falabella', 'Sodimac'],
    targetIndustries: ['Retail', 'Logística'], targetRoles: ['Gerente de Personas'], targetCompanySize: '201-500', targetLocations: ['Chile'],
    sources: { services: [{ url: 'https://acme.cl/servicios', title: 'Servicios' }] },
    pagesRead: [{ url: 'https://acme.cl/', title: 'Acme' }], emptyReason: null, websiteFrom: 'email',
  });
  assert.equal(suggestion.values.services, 'Transitorios: personal temporal\nOutsourcing: procesos');
  assert.equal(suggestion.values.differentiators, 'ISO 9001\nCobertura');
  assert.equal(suggestion.values.referenceClients, 'Falabella, Sodimac');
  assert.equal(suggestion.values.targetIndustries, 'Retail, Logística');
  assert.equal(suggestion.values.targetCompanySize, '201-500');
  assert.deepEqual(suggestion.sources.services, [{ url: 'https://acme.cl/servicios', title: 'Servicios' }]);
});

test('an empty answer says why and what to do next', () => {
  assert.match(autofillEmptyMessage({ emptyReason: 'site_unreachable', domain: 'acme.cl', pagesRead: [] }).title, /No pudimos abrir acme\.cl/);
  assert.match(autofillEmptyMessage({ emptyReason: 'not_identified', domain: 'acme.cl', pagesRead: [{ url: 'x', title: 'y' }] }).description, /Leímos 1 página/);
  assert.match(autofillEmptyMessage({ emptyReason: 'no_sources', domain: '', pagesRead: [] }).description, /Agrega el sitio web/);
});
