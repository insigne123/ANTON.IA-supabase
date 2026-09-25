import assert from 'node:assert/strict';
import test from 'node:test';
import { offerText } from './suplia-context';

test('offer text reads strings and JSON profiles without "[object Object]"', () => {
  assert.equal(offerText('  Automatizamos consultas judiciales  '), 'Automatizamos consultas judiciales');
  assert.equal(offerText({ valueProposition: 'Verificación de antecedentes en minutos' }), 'Verificación de antecedentes en minutos');
  assert.equal(offerText({ name: 'Yago', products: ['AXIS', { name: 'SADT', description: 'registro DT masivo' }] }), 'Yago. Productos: AXIS; SADT: registro DT masivo');
  assert.equal(offerText({ unrelated: { nested: true } }), '');
  assert.equal(offerText(null), '');
});
