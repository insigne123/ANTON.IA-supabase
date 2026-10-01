import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkEmailAgainstName, displayLeadName, firstNameOf, isMaskedName, namePattern, preferredFullName, textNamesPerson,
} from './lead-name';

test('a hidden surname is recognized and shown as an initial', () => {
  assert.equal(isMaskedName('Rafael Du***n'), true);
  assert.equal(isMaskedName('Rafael Durán'), false);
  assert.equal(isMaskedName(null), false);
  assert.deepEqual(displayLeadName('Rafael Du***n'), { text: 'Rafael D.', masked: true });
  assert.deepEqual(displayLeadName('Jose Ca***o'), { text: 'Jose C.', masked: true });
  assert.deepEqual(displayLeadName('Rafael Durán'), { text: 'Rafael Durán', masked: false });
  assert.deepEqual(displayLeadName('  '), { text: '', masked: false });
});

test('the first name greets even while the surname is hidden', () => {
  assert.equal(firstNameOf('Rafael Du***n'), 'Rafael');
  assert.equal(firstNameOf('Susana'), 'Susana');
  assert.equal(firstNameOf('R*** Durán'), null);
  assert.equal(firstNameOf(''), null);
});

test('a complete name wins over a hidden one, and nothing is lost when all are hidden', () => {
  assert.equal(preferredFullName('Rafael Du***n', 'Rafael Durán'), 'Rafael Durán');
  assert.equal(preferredFullName('Rafael Du***n', null, ''), 'Rafael Du***n');
  assert.equal(preferredFullName(null, undefined), null);
});

test('a text names the person even when the provider hid the surname', () => {
  assert.deepEqual(namePattern('Rafael Du***n'), [{ exact: 'rafael' }, { prefix: 'du', suffix: 'n' }]);
  assert.equal(textNamesPerson('Rafael Durán - Jefe de Operaciones - R&D Montajes | LinkedIn', 'Rafael Du***n'), true);
  assert.equal(textNamesPerson('Rafael Godoy, R&D Montajes', 'Rafael Du***n'), false);
  assert.equal(textNamesPerson('rafael duran', 'Rafael Durán'), true, 'without accents or case');
  assert.equal(textNamesPerson('Rafael', 'Rafael'), false, 'a first name alone never identifies anyone');
});

test('an email that carries another surname is flagged, never blocked', () => {
  assert.equal(checkEmailAgainstName('jcastro@grupoexpro.com', 'Jose Ca***o').verdict, 'match');
  assert.equal(checkEmailAgainstName('rafael.duran@rydmontajes.com', 'Rafael Du***n').verdict, 'match');
  assert.equal(checkEmailAgainstName('rduran@rydmontajes.com', 'Rafael Du***n').verdict, 'match');
  assert.equal(checkEmailAgainstName('jgonzalez@empresa.cl', 'Juan Pérez González').verdict, 'match');
  assert.equal(checkEmailAgainstName('rafael@empresa.cl', 'Rafael Du***n').verdict, 'match');
  const other = checkEmailAgainstName('rgodoy@rydmontajes.com', 'Rafael Du***n');
  assert.equal(other.verdict, 'mismatch');
  assert.match(String(other.reason), /podría ser de otra/);
  assert.equal(checkEmailAgainstName('contacto@empresa.cl', 'Rafael Durán').verdict, 'unknown', 'a company mailbox is not personal');
  assert.equal(checkEmailAgainstName('ab1@empresa.cl', 'Rafael Durán').verdict, 'unknown');
  assert.equal(checkEmailAgainstName('pedro@empresa.cl', 'Rafael').verdict, 'unknown', 'without a surname there is nothing to compare');
  assert.equal(checkEmailAgainstName('', 'Rafael Durán').verdict, 'unknown');
});
