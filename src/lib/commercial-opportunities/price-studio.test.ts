import assert from 'node:assert/strict';
import test from 'node:test';
import { costSummary, defaultDraft, laborInputs, parseDraft, scoreInputs, studioKey, typed } from './price-studio';

const filled = () => {
  const draft = defaultDraft();
  Object.assign(draft.profiles[0], { name: 'Guardia de seguridad', headcount: '4', base: '600.000', bonus: '50.000', nonTaxable: '60.000', equipment: '10.000', other: '5.000' });
  Object.assign(draft.params, { absenteeism: '10', overhead: '8', margin: '10' });
  Object.assign(draft.score, { weight: '50', ours: '28', rival: '50', price: '3.600.000' });
  return draft;
};

test('what is typed reads the way it is written in Chile, and nonsense is caught instead of becoming a number', () => {
  assert.equal(typed(''), 0); assert.equal(typed('  '), 0);
  assert.equal(typed('600.000'), 600000); assert.equal(typed('1.500.000'), 1500000); assert.equal(typed('$ 600000'), 600000);
  assert.equal(typed('3,5'), 3.5); assert.equal(typed('0,93'), 0.93); assert.equal(typed('3.5'), 3.5);
  assert.ok(Number.isNaN(typed('abc')));
});

test('the starting draft carries the reference rates as text and nothing for what is a business decision', () => {
  const draft = defaultDraft();
  assert.deepEqual(draft.loads.map(load => load.pct), ['1,5', '3,5', '2,4', '0,93']);
  assert.deepEqual(draft.params, { gratification: '25', cap: '', paidHours: '182', absenteeism: '', overhead: '', margin: '', vat: '19', months: '12' });
  assert.equal(draft.profiles.length, 1); assert.equal(draft.profiles[0].headcount, '1');
  const { profiles, params } = laborInputs(draft);
  assert.deepEqual([params.absenteeismPct, params.overheadPct, params.marginPct, params.gratificationCap], [0, 0, 0, null]);
  assert.deepEqual(params.loads.map(load => load.pct), [1.5, 3.5, 2.4, 0.93]);
  assert.equal(profiles[0].baseSalary, 0);
  assert.notEqual(defaultDraft().profiles[0].id, defaultDraft().profiles[0].id, 'every draft has its own ids');
});

test('a filled draft becomes the numbers of both calculations', () => {
  const { profiles, params } = laborInputs(filled());
  assert.deepEqual(profiles[0], { name: 'Guardia de seguridad', headcount: 4, baseSalary: 600000, bonus: 50000, nonTaxable: 60000, equipment: 10000, other: 5000 });
  assert.deepEqual([params.gratificationPct, params.paidHours, params.absenteeismPct, params.overheadPct, params.marginPct, params.vatPct, params.months], [25, 182, 10, 8, 10, 19, 12]);
  assert.deepEqual(scoreInputs(filled()), { priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 3600000 });
  const capped = filled(); capped.params.cap = '400.000'; capped.loads.push({ id: 'x', label: '', pct: '' }); capped.loads.push({ id: 'y', label: 'Otra', pct: '0,5' });
  const out = laborInputs(capped).params;
  assert.equal(out.gratificationCap, 400000);
  assert.deepEqual(out.loads.map(load => [load.label.slice(0, 5), load.pct]), [['Segur', 1.5], ['Cotiz', 3.5], ['Segur', 2.4], ['Mutua', 0.93], ['Otra', 0.5]], 'an empty line is left out');
  const broken = filled(); broken.profiles[0].base = '6OO.000';
  assert.ok(Number.isNaN(laborInputs(broken).profiles[0].baseSalary) || laborInputs(broken).profiles[0].baseSalary !== 600000);
});

test('what the browser kept comes back as a draft; anything that does not fit gives the starting one', () => {
  const draft = filled();
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  const start = defaultDraft();
  for (const raw of [null, undefined, '', 'no es json', '[]', '"texto"', '{"profiles":"x"}']) {
    const out = parseDraft(raw as never);
    assert.equal(out.profiles.length, 1, String(raw)); assert.deepEqual(out.params, start.params); assert.deepEqual(out.score, start.score);
  }
  const partial = parseDraft(JSON.stringify({ profiles: [{ name: 'Aseo', base: '500000', headcount: 3 }], params: { margin: '12', vat: 7 }, score: { weight: '40' }, extra: 1 }));
  assert.equal(partial.profiles[0].name, 'Aseo'); assert.equal(partial.profiles[0].base, '500000'); assert.equal(partial.profiles[0].headcount, '1', 'a number where text was expected is not trusted');
  assert.equal(partial.params.margin, '12'); assert.equal(partial.params.vat, '19', 'and the starting value fills in'); assert.equal(partial.score.weight, '40'); assert.equal(partial.score.price, '');
  assert.equal(parseDraft(JSON.stringify({ profiles: Array.from({ length: 30 }, () => ({})) })).profiles.length, 12, 'at most twelve profiles');
});

test('the browser key is per person and per opportunity', () => {
  assert.equal(studioKey('u1', 'op-9'), 'anton:price-studio:v1:u1:op-9');
  assert.equal(studioKey(null, 'op-9'), 'anton:price-studio:v1:anon:op-9');
  assert.notEqual(studioKey('u1', 'a'), studioKey('u2', 'a'));
});

test('the summary to copy carries each figure with the assumption behind it, and warns about what is missing', () => {
  const summary = costSummary(filled())!;
  assert.match(summary, /^Valor hora hombre · cálculo interno \(tasas de referencia a octubre de 2026, por confirmar con contabilidad\)/);
  assert.match(summary, /Guardia de seguridad × 4: costo por persona al mes \$941\.640 · costo por hora \$5\.749 · precio por hora neto \$7\.011 · precio mensual neto \$4\.593\.366/);
  assert.match(summary, /Contrato de 12 meses: \$[\d.]+ neto · \$[\d.]+ con IVA/);
  assert.match(summary, /Supuestos: gratificación 25 %; cargas del empleador Seguro de invalidez y sobrevivencia \(SIS\) 1,5 %, .*Mutual: cotización básica 0,93 %/);
  assert.match(summary, /182 horas pagadas al mes; ausentismo 10 %; gastos generales 8 % y margen 10 % del precio\./);
  assert.doesNotMatch(summary, /Ojo:/, 'nothing missing, nothing to warn');
  const bare = costSummary(defaultDraft())!;
  assert.match(bare, /Ojo:/); assert.match(bare, /«Perfil sin nombre» no tiene sueldo base/);
  const bad = filled(); bad.params.overhead = '60'; bad.params.margin = '40';
  assert.equal(costSummary(bad), null, 'no summary of what cannot be priced');
});
