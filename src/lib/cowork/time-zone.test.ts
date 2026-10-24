import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_DEFAULT_TIME_ZONE, coworkTimeZone, coworkZoneLabel } from './time-zone';

test('a time says whose hour it is: Chile by name, another zone by its city', () => {
  assert.equal(coworkZoneLabel(COWORK_DEFAULT_TIME_ZONE), 'hora de Chile');
  assert.equal(coworkZoneLabel('America/Lima'), 'hora de Lima');
  assert.equal(coworkZoneLabel('America/Argentina/Buenos_Aires'), 'hora de Buenos Aires');
  assert.equal(coworkTimeZone('Not/AZone'), COWORK_DEFAULT_TIME_ZONE, 'an unknown zone falls back to Chile');
});
