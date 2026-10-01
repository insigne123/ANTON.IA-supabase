import test from 'node:test';
import assert from 'node:assert/strict';

import { commaItems, lineItems, offerItems } from './profile-lists';

test('services: one per line, and a sentence with commas stays one service', () => {
  assert.deepEqual(offerItems('Outsourcing, Selección, Nómina'), ['Outsourcing', 'Selección', 'Nómina']);
  assert.deepEqual(
    offerItems('Personal temporal para retail, logística y agroindustria en peaks de temporada'),
    ['Personal temporal para retail, logística y agroindustria en peaks de temporada'],
  );
  assert.deepEqual(
    offerItems('- Servicios transitorios: personal temporal, rápido\n• Outsourcing: procesos de apoyo\n\n1. Selección'),
    ['Servicios transitorios: personal temporal, rápido', 'Outsourcing: procesos de apoyo', 'Selección'],
  );
  assert.deepEqual(
    offerItems('AXIS: consultas judiciales en el PJUD, Carga por archivo o por correo'),
    ['AXIS: consultas judiciales en el PJUD', 'Carga por archivo o por correo'],
    'a capital after the comma starts another service',
  );
  assert.deepEqual(offerItems(['A', 'a', ' B ']), ['A', 'B'], 'trimmed and deduplicated without regard to case');
  assert.deepEqual(offerItems(''), []);
});

test('lines and comma lists', () => {
  assert.deepEqual(lineItems('Rotación alta en temporada, sobre todo en retail\nProcesos lentos'), [
    'Rotación alta en temporada, sobre todo en retail',
    'Procesos lentos',
  ]);
  assert.deepEqual(commaItems('Gerente de Personas, Jefe de Operaciones\nGerente de Personas'), ['Gerente de Personas', 'Jefe de Operaciones']);
  assert.deepEqual(commaItems(['Retail, Logística', 'Minería']), ['Retail', 'Logística', 'Minería']);
});
