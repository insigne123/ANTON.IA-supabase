import assert from 'node:assert/strict';
import test from 'node:test';
import { dictatedValue, dictationLanguage, dictationProblem, joinDictated } from './dictation';

test('the language: the person’s Spanish with a region, Chilean Spanish otherwise', () => {
  assert.equal(dictationLanguage(['es-AR', 'en-US']), 'es-AR');
  assert.equal(dictationLanguage(['en-US', 'es-MX']), 'es-MX');
  assert.equal(dictationLanguage(['es', 'en-US']), 'es-CL', 'Spanish without a region');
  assert.equal(dictationLanguage(['en-US']), 'es-CL');
  assert.equal(dictationLanguage(undefined), 'es-CL');
});

test('final pieces are joined once, also when Android repeats the start', () => {
  assert.equal(joinDictated(['busca gerentes', ' de personas ', '']), 'busca gerentes de personas');
  assert.equal(joinDictated(['busca gerentes', 'busca gerentes de personas', 'Busca gerentes de personas en Santiago']), 'Busca gerentes de personas en Santiago');
  assert.equal(joinDictated([]), '');
});

test('what the box says: the text before, a space, and a capital where a sentence starts', () => {
  assert.equal(dictatedValue('', 'busca gerentes de personas'), 'Busca gerentes de personas');
  assert.equal(dictatedValue('Hola', 'busca gerentes'), 'Hola busca gerentes');
  assert.equal(dictatedValue('Hola. ', 'busca gerentes'), 'Hola. Busca gerentes');
  assert.equal(dictatedValue('Hola ', '  en   Santiago '), 'Hola en Santiago');
  assert.equal(dictatedValue('Hola', '   '), 'Hola', 'nothing heard leaves the text as it was');
});

test('the problems are said in plain words, and stopping is not one', () => {
  assert.equal(dictationProblem('aborted'), null);
  assert.match(dictationProblem('not-allowed')!, /permite que el navegador use el micrófono/);
  assert.match(dictationProblem('no-speech')!, /No te escuchamos/);
  assert.match(dictationProblem('algo-raro')!, /No pudimos dictar/);
});
