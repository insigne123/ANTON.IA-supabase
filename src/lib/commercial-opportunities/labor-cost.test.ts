import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LOADS, DEFAULT_PAID_HOURS, DEFAULT_PARAMS, EMPTY_PROFILE, laborCost, laborProblem, type LaborParams, type LaborProfile } from './labor-cost';

const near = (actual: number, expected: number, digits = 2) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≉ ${expected}`);
const guard: LaborProfile = { name: 'Guardia de seguridad', headcount: 4, baseSalary: 600_000, bonus: 50_000, nonTaxable: 60_000, equipment: 10_000, other: 5_000 };
const ok = (profiles: LaborProfile[], params: LaborParams) => { const result = laborCost(profiles, params); assert.ok(!('problem' in result), 'problem' in result ? result.problem : ''); return result as Exclude<ReturnType<typeof laborCost>, { problem: string }>; };

test('the starting rates say what they are: the legal 42 hours and four employer contributions, to be confirmed', () => {
  assert.equal(DEFAULT_PAID_HOURS, 182);
  assert.equal(Math.round(42 * 52 / 12), 182);
  assert.deepEqual(DEFAULT_LOADS.map(load => load.pct), [1.5, 3.5, 2.4, 0.93]);
  assert.equal(DEFAULT_PARAMS.gratificationPct, 25);
  assert.deepEqual([DEFAULT_PARAMS.absenteeismPct, DEFAULT_PARAMS.overheadPct, DEFAULT_PARAMS.marginPct], [0, 0, 0], 'what is a business decision starts empty, and the result warns about it');
});

test('what one person costs a month: salary, legal bonus, contributions on what counts for them, and the allowances and equipment', () => {
  const { profiles } = ok([guard], DEFAULT_PARAMS);
  const [cost] = profiles;
  assert.equal(cost.monthly.gratification, 150_000, '25 % of the base salary');
  const taxable = 600_000 + 150_000 + 50_000;
  near(cost.monthly.loads, taxable * 0.0833, 6);
  near(cost.monthly.total, 941_640, 6);
  near(cost.costPerHour, 941_640 / 182, 6);
  near(cost.pricePerHour, cost.costPerHour, 6);
});

test('overhead and margin are shares of the price, like the financial scenario', () => {
  const result = ok([guard], { ...DEFAULT_PARAMS, overheadPct: 10, marginPct: 8 });
  const [cost] = result.profiles;
  near(cost.pricePerPersonMonth, 941_640 / 0.82, 4);
  near(cost.pricePerHour, 941_640 / 0.82 / 182, 4);
  near(cost.priceMonthly, cost.pricePerPersonMonth * 4, 4);
  near(result.totals.marginMonthly / result.totals.priceMonthly, 0.08, 9);
  near(result.totals.overheadMonthly / result.totals.priceMonthly, 0.10, 9);
  near(result.totals.directMonthly + result.totals.marginMonthly + result.totals.overheadMonthly, result.totals.priceMonthly, 4);
  near(result.totals.vatMonthly, result.totals.priceMonthly * 0.19, 4);
  near(result.totals.contractNet, result.totals.priceMonthly * 12, 4);
  near(result.totals.contractWithVat, result.totals.totalMonthly * 12, 4);
});

test('the hours that are paid and not worked are covered by the hours that are billed', () => {
  const base = ok([guard], DEFAULT_PARAMS).profiles[0];
  const covered = ok([guard], { ...DEFAULT_PARAMS, absenteeismPct: 10 }).profiles[0];
  near(covered.productiveHours, 163.8, 6);
  near(covered.pricePerHour, base.pricePerHour / 0.9, 4);
  assert.equal(covered.monthly.total, base.monthly.total, 'the monthly cost of a person does not change');
});

test('the legal bonus respects the cap the person sets, and several profiles add up with their weighted hour', () => {
  const capped = ok([{ ...guard, baseSalary: 2_000_000 }], { ...DEFAULT_PARAMS, gratificationCap: 400_000 }).profiles[0];
  assert.equal(capped.monthly.gratification, 400_000, '25 % would be 500.000');
  const supervisor: LaborProfile = { name: 'Supervisor', headcount: 1, baseSalary: 900_000, bonus: 0, nonTaxable: 80_000, equipment: 10_000, other: 0 };
  const result = ok([guard, supervisor], { ...DEFAULT_PARAMS, marginPct: 10 });
  const hours = 5 * 182;
  near(result.totals.hoursMonthly, hours, 6);
  near(result.totals.averagePricePerHour, result.totals.priceMonthly / hours, 6);
  near(result.totals.priceMonthly, result.profiles[0].priceMonthly + result.profiles[1].priceMonthly, 4);
  assert.ok(result.profiles[1].pricePerHour > result.profiles[0].pricePerHour);
});

test('what is left out of the price is said before it is trusted', () => {
  const warned = ok([guard], DEFAULT_PARAMS).warnings.join(' ');
  assert.match(warned, /vacaciones y licencias/); assert.match(warned, /gastos generales/); assert.match(warned, /margen es 0/);
  assert.deepEqual(ok([guard], { ...DEFAULT_PARAMS, absenteeismPct: 9, overheadPct: 8, marginPct: 10 }).warnings, []);
  assert.match(ok([guard], { ...DEFAULT_PARAMS, loads: [], absenteeismPct: 9, overheadPct: 8, marginPct: 10 }).warnings.join(' '), /No hay cargas del empleador/);
  assert.match(ok([{ ...EMPTY_PROFILE, name: 'Aseo' }], { ...DEFAULT_PARAMS, absenteeismPct: 9, overheadPct: 8, marginPct: 10 }).warnings.join(' '), /«Aseo» no tiene sueldo base/);
});

test('inputs that cannot be priced say why instead of producing a number', () => {
  assert.equal(laborProblem([guard], DEFAULT_PARAMS), null);
  assert.match(laborProblem([], DEFAULT_PARAMS)!, /al menos un perfil/);
  assert.match(laborProblem([guard], { ...DEFAULT_PARAMS, overheadPct: 60, marginPct: 40 })!, /100 % o más/);
  assert.match(laborProblem([guard], { ...DEFAULT_PARAMS, absenteeismPct: 90 })!, /ausentismo/);
  assert.match(laborProblem([guard], { ...DEFAULT_PARAMS, paidHours: 0 })!, /horas pagadas/);
  assert.match(laborProblem([guard], { ...DEFAULT_PARAMS, months: 0 })!, /plazo/);
  assert.match(laborProblem([{ ...guard, baseSalary: -1 }], DEFAULT_PARAMS)!, /Revisa los números/);
  assert.match(laborProblem([{ ...guard, baseSalary: NaN }], DEFAULT_PARAMS)!, /Revisa los números/);
  assert.deepEqual(laborCost([guard], { ...DEFAULT_PARAMS, months: 0 }), { problem: 'El plazo debe estar entre 1 y 120 meses.' });
});

// The post of a guard service in 4x4 shifts, priced the way a client's form asks for it: the figures are those of a calculator made in a spreadsheet for a
// real bid (the formulas were checked cell by cell), so this is the proof that the tool gives the same price as the sheet.
const shiftGuard: LaborProfile = { name: 'Guardia 4x4', headcount: 2, baseSalary: 604_000, bonus: 0, nonTaxable: 60_000, equipment: 0, other: 0,
  annualBonus: 60_000, holidaysWorked: 8, holidayHours: 11, exempt: 8_000, postPeople: 2, postHours: 334.58 };
const shiftParams: LaborParams = { ...DEFAULT_PARAMS, profitOn: 'cost', marginPct: 10, minimumWage: 539_000, workerDeductionsPct: 19.1, minNet: 670_000, guaranteePct: 10,
  loads: [['Cesantía', 2.4], ['Mutual', 0.93], ['SIS', 1.78], ['Expectativa de vida', 0.72], ['Capitalización individual', 0.1], ['Rentabilidad protegida', 0.9], ['Vacaciones', 5.75], ['Indemnización', 8.33]].map(([label, pct]) => ({ label: label as string, pct: pct as number })),
  expenses: [['Uniformes', 30_000], ['Accesorios', 5_000], ['Credencial y curso', 5_000], ['Supervisor', 60_000], ['Prevencionista', 5_000], ['Radio y celular', 5_000]].map(([label, amount]) => ({ label: label as string, amount: amount as number })),
  // The client's form fixes the hours of each site's month (3 posts are 1.003,75, not 3 × 334,58), and one site's posts cover fewer hours.
  sites: [['Sitio 1', 3, null, 1003.75], ['Sitio 2', 4, null, 1338.33], ['Sitio especial', 1, 309.6, 309.6], ['Sitio 4', 4, null, 1338.33], ['Sitio 5', 4, null, 1338.33], ['Sitio 6', 5, null, 1672.92],
    ['Sitio 7', 4, null, 1338.33], ['Sitio 8', 3, null, 1003.75], ['Sitio 9', 2, null, 669.17]]
    .map(([name, posts, postHours, hoursMonth]) => ({ name: name as string, posts: posts as number, postHours: postHours as number | null, hoursMonth: hoursMonth as number })) };

test('a post in shifts, priced with the margin over the cost and what carries no margin added after it, gives the price of the sheet', () => {
  const result = ok([shiftGuard], shiftParams);
  const [guard] = result.profiles;
  near(guard.monthly.gratification, 151_000, 6);
  near(guard.monthly.loads, 755_000 * 0.2091, 6);
  near(guard.monthly.annualBonus, 5_000, 6);
  near(guard.monthly.holidays, 36_911.11, 2);
  near(guard.monthly.total, 1_124_781.61, 2);
  near(guard.pricePerPersonMonth, 1_245_259.77, 2);
  near(guard.post!.pricePerPost, 2_490_519.54, 2);
  near(guard.pricePerHour, 7_443.72, 2);
  near(guard.hoursPerPerson, 167.29, 6);
  near(guard.net!, 670_795, 6);
  assert.equal(result.warnings.some(w => /líquido/.test(w)), false, 'the net pay reaches the minimum the bases ask for');
  assert.match(result.notes.join(' '), /valor hora queda en la mitad/);
  near(result.totals.exemptMonthly, 16_000, 6);
  near(result.totals.directMonthly + result.totals.overheadMonthly + result.totals.marginMonthly + result.totals.exemptMonthly, result.totals.priceMonthly, 4);
});

test('the sites are priced from the cost of a post over the hours their posts cover, and the bond is a share of the year', () => {
  const { sites } = ok([shiftGuard], shiftParams);
  assert.deepEqual(sites!.rows.map(row => row.priceMonthly), [7_471_633, 9_962_153, 2_490_520, 9_962_153, 9_962_153, 12_452_747, 9_962_153, 7_471_633, 4_981_114]);
  near(sites!.rows[0].pricePerHour, 7_443.72, 2);
  near(sites!.rows[2].pricePerHour, 8_044.31, 2);
  assert.equal(sites!.rows[0].hoursMonth, 1003.75);
  assert.equal(ok([shiftGuard], { ...shiftParams, sites: [{ name: 'Sitio', posts: 3 }] }).sites!.rows[0].hoursMonth, 3 * 334.58, 'without hours fixed by the client, the posts give them');
  assert.equal(sites!.monthly, 74_716_259);
  assert.equal(sites!.annual, 896_595_108);
  near(sites!.guarantee, 89_659_510.8, 1);
  assert.equal(sites!.profile, 'Guardia 4x4');
});

test('the net pay under the minimum the bases ask for is said, and a salary that makes it is not', () => {
  const low = ok([{ ...shiftGuard, baseSalary: 560_000 }], shiftParams);
  assert.match(low.warnings.join(' '), /líquido estimado de «Guardia 4x4» \(\$6\d\d\.\d{3}\) queda bajo el mínimo/);
  assert.equal(ok([shiftGuard], { ...shiftParams, workerDeductionsPct: 0 }).profiles[0].net, null, 'without the worker deductions there is no net to compare');
});

test('the margin over the cost is not the margin over the price: the same 10 % gives a different price', () => {
  const noExempt = { ...shiftGuard, exempt: 0 };
  const onCost = ok([noExempt], shiftParams).profiles[0].pricePerPersonMonth;
  const onPrice = ok([noExempt], { ...shiftParams, profitOn: 'price' }).profiles[0].pricePerPersonMonth;
  near(onPrice / onCost, (1 / 0.9) / 1.1, 9);
  assert.ok(onPrice > onCost);
});

test('a bonus cap comes from the minimum wage unless the person set one, and holidays need their hours to count', () => {
  const big = { ...shiftGuard, baseSalary: 1_500_000 };
  near(ok([big], shiftParams).profiles[0].monthly.gratification, 4.75 * 539_000 / 12, 6);
  assert.equal(ok([big], { ...shiftParams, gratificationCap: 300_000 }).profiles[0].monthly.gratification, 300_000, 'the cap the person set wins');
  assert.equal(ok([big], { ...shiftParams, minimumWage: null }).profiles[0].monthly.gratification, 375_000, 'without a minimum wage or a cap there is no cap');
  assert.match(ok([{ ...shiftGuard, holidayHours: 0 }], shiftParams).warnings.join(' '), /trabaja festivos pero no dice cuántas horas/);
});

test('a post asks for its people, and the shapes that cannot be priced say why', () => {
  assert.match(laborProblem([{ ...shiftGuard, postPeople: 0 }], shiftParams)!, /cuántas personas cubren el puesto/);
  assert.match(laborProblem([{ ...shiftGuard, postHours: 800 }], shiftParams)!, /744/);
  assert.match(laborProblem([shiftGuard], { ...shiftParams, workerDeductionsPct: 100 })!, /100 %/);
  assert.match(laborProblem([shiftGuard], { ...shiftParams, guaranteePct: 120 })!, /garantía/);
  assert.match(laborProblem([shiftGuard], { ...shiftParams, weeklyHours: 0 })!, /jornada semanal/);
  assert.match(laborProblem([shiftGuard], { ...shiftParams, expenses: [{ label: 'x', amount: -1 }] })!, /Revisa los números/);
  assert.equal(laborProblem([shiftGuard], { ...shiftParams, overheadPct: 60, marginPct: 60 }), null, 'over the cost, a markup can pass 100 %');
  assert.match(laborProblem([shiftGuard], { ...shiftParams, profitOn: 'price', overheadPct: 60, marginPct: 60 })!, /100 % o más/);
});

test('sites need a post to be priced, and with several profiles with posts the first one is used and the rest is said', () => {
  assert.match(ok([{ ...shiftGuard, postHours: 0, postPeople: 0 }], shiftParams).warnings.join(' '), /ningún perfil tiene puesto/);
  assert.equal(ok([{ ...shiftGuard, postHours: 0, postPeople: 0 }], shiftParams).sites, null);
  const result = ok([shiftGuard, { ...shiftGuard, name: 'Portero', postPeople: 1, postHours: 334.58 }], shiftParams);
  assert.equal(result.sites!.profile, 'Guardia 4x4');
  assert.match(result.warnings.join(' '), /usa el puesto de «Guardia 4x4»/);
  assert.equal(ok([shiftGuard], { ...shiftParams, sites: [] }).sites, null);
});

test('what was priced before the shifts, the holidays and the sites existed does not change', () => {
  const before = ok([guard], { ...DEFAULT_PARAMS, overheadPct: 10, marginPct: 8 });
  assert.equal(before.sites, null); assert.deepEqual(before.notes, []);
  near(before.profiles[0].pricePerHour, 941_640 / 0.82 / 182, 4);
  assert.equal(before.profiles[0].net, null); assert.equal(before.profiles[0].post, null); assert.equal(before.totals.exemptMonthly, 0);
});
