import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTerm, canLookUpEmail, emailLookupBatch, emailLookupLabel, formatRate, formatRateCompact, icpPeriod, includesTerm, recommendationLink } from './view';

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
  // An enriched contact still without email is retried from «Por escribir»: the link opens it and promises no search.
  assert.deepEqual(recommendationLink({ list: 'por_escribir', missing: ['buscar su correo'] }), { href: '/saved/leads/enriched', label: 'Abrir' });
  assert.deepEqual(recommendationLink({ missing: ['investigarla'] }), { href: '/saved/leads/enriched', label: 'Abrir' });
});

test('a saved contact without email gets it looked up right there, the best first and one batch at most', () => {
  assert.equal(canLookUpEmail({ list: 'por_completar', missing: ['buscar su correo', 'investigarla'] }), true);
  assert.equal(canLookUpEmail({ missing: ['buscar su correo'] }), true, 'a saved contact without list is «Por completar»');
  assert.equal(canLookUpEmail({ list: 'por_completar', missing: ['investigarla'] }), false, 'it already has an email');
  assert.equal(canLookUpEmail({ list: 'por_escribir', missing: ['buscar su correo'] }), false, 'searched before: retried in «Por escribir»');
  const items = Array.from({ length: 14 }, (_, index) => ({ leadId: `l${index}`, list: (index === 1 ? 'por_escribir' : 'por_completar') as 'por_escribir' | 'por_completar',
    missing: index === 2 ? [] : ['buscar su correo'] }));
  assert.deepEqual(emailLookupBatch(items), ['l0', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11']);
  assert.deepEqual(emailLookupBatch(items, 2), ['l0', 'l3']);
  assert.equal(emailLookupLabel(1), 'Buscar 1 correo · 1 crédito');
  assert.equal(emailLookupLabel(4), 'Buscar 4 correos · 4 créditos');
});
