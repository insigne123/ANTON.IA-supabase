import assert from 'node:assert/strict';
import test from 'node:test';
import { spanishForCopiedEnglish } from './copied-english';

test('English copied from the source is said in Spanish, and the companies keep their names', () => {
  // Real research, 31 Oct 2026: the corrective retry only warns about English, and these reached the draft.
  assert.equal(spanishForCopiedEnglish('Acme tiene subsidiarias comerciales en United Kingdom.'), 'Acme tiene subsidiarias comerciales en Reino Unido.');
  assert.equal(spanishForCopiedEnglish('Son parte de su estructura commercial.'), 'Son parte de su estructura comercial.');
  assert.equal(spanishForCopiedEnglish('Acme tiene filiales en el Reino Unido (United Kingdom).'), 'Acme tiene filiales en el Reino Unido.');
  assert.equal(spanishForCopiedEnglish('Sus filiales en South Korea y the Netherlands crecen.'), 'Sus filiales en Corea del Sur y Países Bajos crecen.');
  // A capitalised word may be a name, and the companies' names are never touched.
  assert.equal(spanishForCopiedEnglish('Trabajan con Commercial Bank.'), 'Trabajan con Commercial Bank.');
  assert.equal(spanishForCopiedEnglish('Turkey Hill Foods abrió en Turkey.', ['Turkey Hill Foods']), 'Turkey Hill Foods abrió en Turquía.');
  assert.equal(spanishForCopiedEnglish('Acme abrirá dos tiendas en la zona sur.'), 'Acme abrirá dos tiendas en la zona sur.');
});
