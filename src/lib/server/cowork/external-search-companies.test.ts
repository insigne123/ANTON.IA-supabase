import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_SEARCH_NOTICE, normalizeCoworkSearchResult } from './external-search';

// Apollo's company search on 6 Nov 2026 (fictional companies): no industry, headcount or city, sometimes the activity codes.
test('company results take the sector from the activity codes and say what Apollo does not bring', () => {
  const result = normalizeCoworkSearchResult({ organizations: [
    { id: 'org1', name: 'Hotel del Puerto', primary_domain: 'hoteldelpuerto.cl', naics_codes: ['721110'] },
    { id: 'org2', name: 'Transportes Sur', primary_domain: 'transportessur.cl', sic_codes: ['4213'] },
    { id: 'org3', name: 'Sin Códigos SpA', primary_domain: null },
    { id: 'org4', name: 'Con Rubro', industry: 'hospitality', naics_codes: ['484121'], estimated_num_employees: 120, city: 'Concepción', country: 'Chile' },
  ] }, 25, 'companies') as any;
  assert.deepEqual(result.items.map((item: any) => item.industry), ['Hotelería y alojamiento', 'Transporte y logística', null, 'hospitality']);
  assert.equal(result.items[3].employees, 120);
  assert.equal(result.items[3].location, 'Concepción, Chile');
  assert.equal(result.notice, COMPANY_SEARCH_NOTICE);
  assert.match(result.notice, /no entrega el rubro, la dotación ni la ciudad/);
});
