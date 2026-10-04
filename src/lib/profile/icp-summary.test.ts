import assert from 'node:assert/strict';
import test from 'node:test';

import { icpSummary } from './icp-summary';

test('the ideal customer summary reads the four search fields like Búsqueda does', () => {
  const summary = icpSummary({
    targetRoles: 'Gerente de Personas, Jefe de Operaciones ,',
    targetIndustries: ' Retail, logística',
    targetCompanySize: '5001+',
    targetLocations: 'Chile, Perú',
  });
  assert.equal(summary.defined, true);
  assert.deepEqual(summary.rows.map((row) => [row.id, row.values]), [
    ['roles', ['Gerente de Personas', 'Jefe de Operaciones']],
    ['industries', ['Retail', 'logística']],
    ['size', ['5001 o más personas']],
    ['locations', ['Chile', 'Perú']],
  ]);
});

test('without roles or industries there is no ideal customer, and empty fields say what the search does', () => {
  assert.equal(icpSummary({ targetCompanySize: '11-50', targetLocations: 'Chile' }).defined, false);
  const onlyRoles = icpSummary({ targetRoles: 'Gerente comercial' });
  assert.equal(onlyRoles.defined, true);
  assert.deepEqual(onlyRoles.rows.filter((row) => row.values.length === 0).map((row) => row.empty),
    ['Cualquier industria', 'Cualquier tamaño', 'Chile (por defecto)']);
});
