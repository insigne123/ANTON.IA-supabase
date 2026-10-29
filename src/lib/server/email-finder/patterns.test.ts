import assert from 'node:assert/strict';
import test from 'node:test';

import { confidentPattern, domainEvidence, emailCandidates, normalizeDomain, parseName } from './patterns';

test('names lose accents and initials, and keep a second given name apart from the surnames', () => {
  assert.deepEqual(parseName({ fullName: 'José Ñúñez Pérez' }), { first: 'jose', second: '', last1: 'nunez', last2: 'perez' });
  assert.deepEqual(parseName({ firstName: 'Tomás', lastName: 'Lagos R' }), { first: 'tomas', second: '', last1: 'lagos', last2: '' });
  assert.deepEqual(parseName({ firstName: 'Marta', lastName: 'Elisa Fuenzalida' }), { first: 'marta', second: 'elisa', last1: 'fuenzalida', last2: '' });
  assert.deepEqual(parseName({ firstName: 'Juan Diego', lastName: 'Molina Araya' }), { first: 'juan', second: 'diego', last1: 'molina', last2: 'araya' });
  assert.deepEqual(parseName({ fullName: 'Hugo De La Fuente Ortiz' }), { first: 'hugo', second: '', last1: 'delafuente', last2: 'ortiz' });
  assert.deepEqual(parseName({ firstName: 'Hugo', lastName: 'Del Valle' }), { first: 'hugo', second: '', last1: 'delvalle', last2: '' });
});

test('a name without a usable surname, or masked by the provider, gives no candidates', () => {
  assert.equal(parseName({ firstName: 'Pedro', lastName: 'B' }), null);
  assert.equal(parseName({ fullName: 'Lucia M' }), null);
  assert.equal(parseName({ firstName: 'Mario', lastName: 'Ro***s' }), null);
});

test('domains come from websites, and free mail providers are not company domains', () => {
  assert.equal(normalizeDomain('https://www.Ejemplo.cl/contacto'), 'ejemplo.cl');
  assert.equal(normalizeDomain('minera.test'), 'minera.test');
  assert.equal(normalizeDomain('gmail.com'), '');
  assert.equal(normalizeDomain('not a domain'), '');
});

test('the company format seen in known addresses goes first', () => {
  const evidence = domainEvidence([
    { local: 'crivas', name: parseName({ fullName: 'Claudio Rivas Mena' }) },
    { local: 'ctoro', name: parseName({ fullName: 'Carla Toro' }) },
    { local: 'sergio.vidal', name: parseName({ fullName: 'Sergio Vidal Pino' }) },
    { local: 'pramo002', name: parseName({ fullName: 'Paola Ramos Tapia' }) },
  ]);
  assert.deepEqual(evidence.order, ['flast', 'first.last']);
  const candidates = emailCandidates(parseName({ fullName: 'Paula Soto Rojas' })!, 'minera.test', evidence, 4);
  assert.deepEqual(candidates.map(candidate => candidate.email), [
    'psoto@minera.test', 'paula.soto@minera.test', 'paulasoto@minera.test', 'p.soto@minera.test',
  ]);
  // 2 of 4 known addresses is not enough to trust a guess the server cannot confirm.
  assert.equal(confidentPattern(evidence), null);
});

test('without known addresses, the common formats are tried without repeats', () => {
  const candidates = emailCandidates(parseName({ fullName: 'Ana-Luisa Bravo' })!, 'acero.test', domainEvidence([]), 6);
  assert.deepEqual(candidates.map(candidate => candidate.email.split('@')[0]), [
    'analuisa.bravo', 'abravo', 'analuisabravo', 'a.bravo', 'analuisa', 'analuisa_bravo',
  ]);
});

test('a clear company format is trusted for a guess', () => {
  const evidence = domainEvidence([
    { local: 'acastro', name: parseName({ fullName: 'Alex Castro Diaz' }) },
    { local: 'acid', name: parseName({ fullName: 'Andrea Cid Moreno' }) },
    { local: 'kespinoza', name: parseName({ fullName: 'Karla Espinoza' }) },
  ]);
  assert.equal(confidentPattern(evidence), 'flast');
});
