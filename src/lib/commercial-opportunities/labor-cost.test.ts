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
