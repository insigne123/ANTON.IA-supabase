import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanRoleVariants, hiringQueries, linkedinLocations, linkedinTitles, regionQueryName, regionsFromPlaces, searchRoles,
} from './search-terms';

test('the roles of a search are trimmed, each once and at most fifteen', () => {
  assert.deepEqual(searchRoles([' Cajero ', 'cajero', 'x', 'Bodeguero', 42, '']), ['Cajero', 'Bodeguero']);
  assert.equal(searchRoles(Array.from({ length: 20 }, (_, index) => `cargo ${index}`)).length, 15);
});

test('a variant adds something: never what the role already finds, another role of the search or a repeat', () => {
  const variants = cleanRoleVariants(['cajero', 'bodeguero', 'guardia'], {
    Cajero: ['cajera', 'Cajeros', 'cajero/a', 'operador de caja', 'Cashier', 'cashier', 'bodeguero', 'x', 'cajero vendedor', 'reponedor', 'polifuncional', 'otro más'],
    bodeguero: ['Operario de bodega', 'warehouse worker', 'Encargado de Bodega'],
    guardia: ['guardia de seguridad', 'Guardias', 'vigilante', 'security guard'],
    conductor: ['chofer'],
  });
  assert.deepEqual(variants, {
    cajero: ['operador de caja', 'Cashier', 'reponedor', 'polifuncional'],
    bodeguero: ['Operario de bodega', 'warehouse worker', 'Encargado de Bodega'],
    guardia: ['vigilante', 'security guard'],
  }, 'at most four, matched by name without case; «cajero vendedor» and «guardia de seguridad» are already found; a role outside the search is ignored');
  assert.deepEqual(cleanRoleVariants(['guardia'], null), {});
});

test('each role is asked in each region chosen, the roles first and then their variants, up to the cap', () => {
  const variants = { cajero: ['cashier'] };
  assert.deepEqual(hiringQueries(['cajero', 'bodeguero'], variants, [], 10), { queries: ['cajero', 'bodeguero', 'cashier'], left: 0 });
  assert.deepEqual(hiringQueries(['cajero', 'bodeguero'], variants, ['Metropolitana', 'Antofagasta'], 4), {
    queries: ['cajero Santiago', 'cajero Antofagasta', 'bodeguero Santiago', 'bodeguero Antofagasta'], left: 2,
  });
  assert.equal(regionQueryName('Metropolitana'), 'Santiago');
  assert.deepEqual(linkedinTitles(['cajero', 'bodeguero'], variants), ['cajero', 'bodeguero', 'cashier']);
  assert.deepEqual(linkedinLocations(['Metropolitana']), ['Santiago, Chile']);
  assert.deepEqual(linkedinLocations([]), ['Chile']);
});

test('the places of «Tu cliente ideal» become regions of the country, in their order', () => {
  assert.deepEqual(regionsFromPlaces(['Santiago', 'Calama', 'Concepción', 'Perú', 'Antofagasta']), ['Antofagasta', 'Metropolitana', 'Biobío']);
  assert.deepEqual(regionsFromPlaces(['Chile']), [], 'the whole country is no region');
});
