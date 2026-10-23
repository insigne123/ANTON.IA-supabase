import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVISION_LABELS, costSummary, defaultDraft, laborInputs, newExpense, newProfile, newSite, parseDraft, scoreInputs, studioKey, typed } from './price-studio';

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
  assert.deepEqual(draft.loads.map(load => load.pct), ['1,5', '3,5', '2,4', '0,93', '', ''], 'the two provisions are there to fill in, with no rate');
  assert.deepEqual(draft.loads.slice(4).map(load => load.label), [...PROVISION_LABELS]);
  assert.deepEqual(draft.params, { gratification: '25', cap: '', paidHours: '182', absenteeism: '', overhead: '', margin: '', vat: '19', months: '12',
    profitOn: 'price', minimumWage: '', weeklyHours: '42', workerDeductions: '', minNet: '', guarantee: '' });
  assert.deepEqual([draft.expenses, draft.sites], [[], []]);
  assert.equal(draft.profiles.length, 1); assert.equal(draft.profiles[0].headcount, '1');
  const { profiles, params } = laborInputs(draft);
  assert.deepEqual([params.absenteeismPct, params.overheadPct, params.marginPct, params.gratificationCap], [0, 0, 0, null]);
  assert.deepEqual(params.loads.map(load => load.pct), [1.5, 3.5, 2.4, 0.93, 0, 0], 'a provision with no rate counts for nothing');
  assert.deepEqual([params.profitOn, params.minimumWage, params.weeklyHours, params.workerDeductionsPct, params.minNet, params.guaranteePct, params.expenses, params.sites], ['price', null, 42, 0, null, 0, [], []]);
  assert.equal(profiles[0].baseSalary, 0);
  assert.notEqual(defaultDraft().profiles[0].id, defaultDraft().profiles[0].id, 'every draft has its own ids');
});

test('a filled draft becomes the numbers of both calculations', () => {
  const { profiles, params } = laborInputs(filled());
  assert.deepEqual(profiles[0], { name: 'Guardia de seguridad', headcount: 4, baseSalary: 600000, bonus: 50000, nonTaxable: 60000, equipment: 10000, other: 5000,
    annualBonus: 0, holidaysWorked: 0, holidayHours: 0, exempt: 0, postPeople: 0, postHours: 0 });
  assert.deepEqual([params.gratificationPct, params.paidHours, params.absenteeismPct, params.overheadPct, params.marginPct, params.vatPct, params.months], [25, 182, 10, 8, 10, 19, 12]);
  assert.deepEqual(scoreInputs(filled()), { priceWeight: 50, ourOthers: 28, rivalOthers: 50, ourPrice: 3600000 });
  const capped = filled(); capped.params.cap = '400.000'; capped.loads.push({ id: 'x', label: '', pct: '' }); capped.loads.push({ id: 'y', label: 'Otra', pct: '0,5' });
  const out = laborInputs(capped).params;
  assert.equal(out.gratificationCap, 400000);
  assert.deepEqual(out.loads.map(load => [load.label.slice(0, 5), load.pct]), [['Segur', 1.5], ['Cotiz', 3.5], ['Segur', 2.4], ['Mutua', 0.93], ['Vacac', 0], ['Indem', 0], ['Otra', 0.5]], 'an empty line is left out');
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

// The post of a guard service in 4x4 shifts typed as a person would, to the figures of the spreadsheet it was made from.
const shiftDraft = () => {
  const draft = defaultDraft();
  Object.assign(draft.profiles[0], { name: 'Guardia 4x4', headcount: '2', base: '604.000', nonTaxable: '60.000', annualBonus: '60.000', holidays: '8', holidayHours: '11', exempt: '8.000', postPeople: '2', postHours: '334,58' });
  draft.loads = [['Cesantía', '2,4'], ['Mutual', '0,93'], ['SIS', '1,78'], ['Expectativa de vida', '0,72'], ['Capitalización individual', '0,1'], ['Rentabilidad protegida', '0,9'], ['Vacaciones (provisión)', '5,75'], ['Indemnización por años de servicio (provisión)', '8,33']]
    .map(([label, pct], index) => ({ id: `l${index}`, label, pct }));
  draft.expenses = [['Uniformes', '30.000'], ['Accesorios', '5.000'], ['Credencial y curso', '5.000'], ['Supervisor', '60.000'], ['Prevencionista', '5.000'], ['Radio y celular', '5.000']].map(([label, amount], index) => ({ id: `e${index}`, label, amount }));
  draft.sites = [['Sitio 1', '3', '', '1.003,75'], ['Sitio especial', '1', '309,6', '309,6']].map(([name, posts, postHours, hoursMonth], index) => ({ id: `s${index}`, name, posts, postHours, hoursMonth }));
  Object.assign(draft.params, { profitOn: 'cost', margin: '10', minimumWage: '539.000', workerDeductions: '19,1', minNet: '670.000', guarantee: '10' });
  return draft;
};

test('the new fields are read the way they are typed: blank means «not set», a post comes with its people, a site with its hours', () => {
  const { profiles, params } = laborInputs(shiftDraft());
  assert.deepEqual([profiles[0].annualBonus, profiles[0].holidaysWorked, profiles[0].holidayHours, profiles[0].exempt, profiles[0].postPeople, profiles[0].postHours], [60000, 8, 11, 8000, 2, 334.58]);
  assert.deepEqual([params.profitOn, params.minimumWage, params.weeklyHours, params.workerDeductionsPct, params.minNet, params.guaranteePct], ['cost', 539000, 42, 19.1, 670000, 10]);
  assert.deepEqual(params.expenses!.slice(0, 2), [{ label: 'Uniformes', amount: 30000 }, { label: 'Accesorios', amount: 5000 }]);
  assert.deepEqual(params.sites, [{ name: 'Sitio 1', posts: 3, postHours: null, hoursMonth: 1003.75 }, { name: 'Sitio especial', posts: 1, postHours: 309.6, hoursMonth: 309.6 }]);
  const odd = shiftDraft(); odd.params.profitOn = 'otra cosa'; odd.params.weeklyHours = ''; odd.sites.push({ id: 'z', name: '', posts: '', postHours: '', hoursMonth: '' });
  assert.equal(laborInputs(odd).params.profitOn, 'price'); assert.equal(laborInputs(odd).params.weeklyHours, 42); assert.equal(laborInputs(odd).params.sites!.length, 2, 'an empty site is left out');
});

test('a draft kept before shifts, sites and expenses existed still opens, and the new ones are kept and trimmed', () => {
  const old = parseDraft(JSON.stringify({ profiles: [{ id: 'a', name: 'Aseo', headcount: '3', base: '500000', bonus: '', nonTaxable: '', equipment: '', other: '' }], loads: [{ id: 'l', label: 'SIS', pct: '1,5' }],
    params: { gratification: '25', cap: '', paidHours: '182', absenteeism: '5', overhead: '', margin: '10', vat: '19', months: '12' }, score: {} }));
  assert.equal(old.profiles[0].postHours, ''); assert.equal(old.params.profitOn, 'price'); assert.equal(old.params.weeklyHours, '42');
  assert.deepEqual([old.expenses, old.sites], [[], []]); assert.equal(old.loads.length, 1, 'what the person had stays as it was');
  const draft = shiftDraft();
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  assert.equal(parseDraft(JSON.stringify({ sites: Array.from({ length: 60 }, () => ({})), expenses: Array.from({ length: 30 }, () => ({})) })).sites.length, 40);
  assert.equal(parseDraft(JSON.stringify({ params: { profitOn: 'raro' } })).params.profitOn, 'price');
  for (const make of [newProfile, newExpense, newSite]) assert.notEqual(make().id, make().id);
});

test('the summary of a post gives the price of the post, the sites and the bond, and warns about the form that halves the hour', () => {
  const summary = costSummary(shiftDraft())!;
  assert.match(summary, /Guardia 4x4 × 2: costo por persona al mes \$1\.124\.782 · costo por hora \$6\.724 · precio por hora neto \$7\.444 · precio mensual neto \$2\.490\.520/);
  assert.match(summary, /Puesto de 2 personas que cubre 334,58 horas al mes: precio del puesto \$2\.490\.520 neto por mes \(el total de las 2, no de una\)/);
  assert.match(summary, /Líquido estimado por persona: \$670\.795/);
  assert.match(summary, /- Sitio 1: 1\.003,75 horas al mes × \$7\.444 = \$7\.471\.633 neto al mes · \$89\.659\.596 al año/);
  assert.match(summary, /- Sitio especial: 309,6 horas al mes × \$8\.044 = \$2\.490\.520 neto al mes/);
  assert.match(summary, /Total de los sitios: \$9\.962\.153 al mes · \$119\.545\.836 al año · garantía de fiel cumplimiento \(10 % del monto anual\): \$11\.954\.584/);
  assert.match(summary, /con tope de 4,75 ingresos mínimos al año \(\$213\.354 al mes\)/);
  assert.match(summary, /gastos por persona al mes: Uniformes \$30\.000, Accesorios \$5\.000/);
  assert.match(summary, /utilidad 10 % del costo; los costos sin utilidad \(asistencia, boleta, seguros\) se suman después\./);
  assert.match(summary, /Ojo con la planilla del cliente:\n- «Guardia 4x4»: un puesto cubre 334,58 horas al mes con 2 personas en turno\. .* la mitad/);
  assert.doesNotMatch(summary, /Vacaciones \(provisión\) 0 %/, 'a rate that is 0 is not listed as an assumption');
});
