import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTerm, formatRate, formatRateCompact, icpPeriod, includesTerm, recommendationLink } from './view';

test('rates read with their probable range, in a sentence or in a table', () => {
  assert.equal(formatRate(null), '—');
  assert.equal(formatRate({ pct: 3.1, low: 0.9, high: 10.6 }), '3,1 %, entre 0,9 % y 10,6 %');
  assert.equal(formatRateCompact({ pct: 20, low: 5.7, high: 51 }), '20 % (5,7–51)');
});

test('the period of the sends, one day or a range', () => {
  assert.equal(icpPeriod(null, '2026-09-30'), '');
  assert.match(icpPeriod('2026-09-02', '2026-09-30'), /^ entre el 2 sept?\.? y el 30 sept?\.?$/);
  assert.match(icpPeriod('2026-09-30', '2026-09-30'), /^ el 30 sept?\.?$/);
});

test('an industry is added to «Perfil» once, ignoring case and accents', () => {
  assert.equal(includesTerm('Retail, Minería', 'mineria'), true);
  assert.equal(appendTerm('Retail, Minería', 'MINERÍA'), 'Retail, Minería');
  assert.equal(appendTerm('Retail', 'Logística'), 'Retail, Logística');
  assert.equal(appendTerm('', 'Logística'), 'Logística');
});

test('each recommended contact goes where the person acts on it', () => {
  assert.deepEqual(recommendationLink({ list: 'por_escribir', missing: [] }), { href: '/saved/leads/enriched', label: 'Escribir' });
  assert.deepEqual(recommendationLink({ list: 'por_completar', missing: ['buscar su correo', 'investigarla'] }), { href: '/saved/leads', label: 'Buscar correo' });
  assert.deepEqual(recommendationLink({ missing: ['investigarla'] }), { href: '/saved/leads', label: 'Abrir' });
});
