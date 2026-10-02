import test from 'node:test';
import assert from 'node:assert/strict';
import { companySearchHref, companySearchPrefill } from './company-prefill';

test('«Buscar decisores» opens Búsqueda by company with the roles, and Búsqueda reads it back', () => {
  const href = companySearchHref({ company: 'Securitas Chile', domain: 'securitas.cl', titles: ['Gerente de Personas', 'Jefe de Operaciones'] });
  assert.equal(href, '/search?company=Securitas+Chile&domain=securitas.cl&titles=Gerente+de+Personas%2C+Jefe+de+Operaciones');
  assert.deepEqual(companySearchPrefill(href.slice('/search'.length)), {
    companyName: 'Securitas Chile', companyDomains: 'securitas.cl', title: 'Gerente de Personas, Jefe de Operaciones',
  });
});

test('without a company or a valid domain there is nothing to fill; a bad domain is dropped', () => {
  assert.equal(companySearchPrefill(''), null);
  assert.equal(companySearchPrefill('?titles=Gerente'), null);
  assert.equal(companySearchPrefill('?domain=javascript:alert(1)'), null);
  assert.deepEqual(companySearchPrefill('?company=Acme&domain=no%20es%20dominio'), { companyName: 'Acme', companyDomains: '', title: '' });
  assert.equal(companySearchPrefill(`?company=${'a'.repeat(500)}`)?.companyName.length, 120);
});
