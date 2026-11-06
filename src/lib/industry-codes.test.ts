import test from 'node:test';
import assert from 'node:assert/strict';
import { industryCodes, sectorFromIndustryCodes } from './industry-codes';

test('NAICS codes name the sector, the finest group first', () => {
  assert.equal(sectorFromIndustryCodes({ naics: ['721110'] }), 'Hotelería y alojamiento');
  assert.equal(sectorFromIndustryCodes({ naics: ['722511'] }), 'Restaurantes y servicios de comida');
  assert.equal(sectorFromIndustryCodes({ naics: ['561320'] }), 'Servicios de personal y empleo');
  assert.equal(sectorFromIndustryCodes({ naics: ['493110'] }), 'Bodegaje y almacenamiento');
  assert.equal(sectorFromIndustryCodes({ naics: ['445110'] }), 'Supermercados y comercio de alimentos');
  assert.equal(sectorFromIndustryCodes({ naics: ['236220'] }), 'Construcción');
  assert.equal(sectorFromIndustryCodes({ naics: [541511] }), 'Servicios profesionales y técnicos');
});

test('SIC codes answer when NAICS is missing or unknown', () => {
  assert.equal(sectorFromIndustryCodes({ naics: ['99'], sic: ['7011'] }), 'Hotelería y alojamiento');
  assert.equal(sectorFromIndustryCodes({ sic: ['5812'] }), 'Restaurantes y servicios de comida');
  assert.equal(sectorFromIndustryCodes({ sic: ['7363'] }), 'Servicios de personal y empleo');
  assert.equal(sectorFromIndustryCodes({ sic: ['4213'] }), 'Transporte y logística');
  assert.equal(sectorFromIndustryCodes({ sic: ['0100'] }), 'Agricultura, ganadería, silvicultura y pesca');
});

test('nothing known says nothing', () => {
  assert.equal(sectorFromIndustryCodes({}), null);
  assert.equal(sectorFromIndustryCodes({ naics: null, sic: 'x' }), null);
  assert.deepEqual(industryCodes(['7211', ' 7211 ', 'abc', 12, null, '1']), ['7211', '12']);
});
