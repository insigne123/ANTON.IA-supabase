import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// What is left of each cap of Oportunidades, counted as opportunity_budget_reserve counts it, with the tables in memory.
const bundle = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-budget';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'stubs', setup(builder) {
    builder.onResolve({ filter: /\/workspace-store$/ }, args => ({ path: args.path, namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export function opportunityDb(result){ if (result.error) throw Error(result.error.message); return result.data }' }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { budgetRefusal, budgetRefusalMessage, opportunityBudgetRoom, reportBudgetCheck, reportCostEstimate, REPORT_TOO_LONG } = compiled.exports;

const NOW = new Date('2026-10-24T16:00:00.000Z');
type Row = Record<string, unknown>;
/** A client over rows: eq, neq and «or» of eq/neq filters, ranges, and the one row of a month. */
function memory(tables: Record<string, Row[]>, fail = false) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const test = (column: string, op: string, value: unknown) => (row: Row) => op === 'eq' ? String(row[column]) === String(value) : String(row[column]) !== String(value);
      const result = () => {
        if (fail) return { data: null, error: { message: 'down' } };
        const rows = (tables[table] || []).filter(row => filters.every(keep => keep(row)));
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null };
      };
      const chain: any = {
        select: () => chain, order: () => chain,
        eq: (column: string, value: unknown) => { filters.push(test(column, 'eq', value)); return chain; },
        neq: (column: string, value: unknown) => { filters.push(test(column, 'neq', value)); return chain; },
        or: (expression: string) => {
          const any = expression.split(',').map(part => { const [column, op, ...value] = part.split('.'); return test(column, op, value.join('.')); });
          filters.push(row => any.some(keep => keep(row))); return chain;
        },
        range: (from: number, to: number) => { range = [from, to]; return chain; },
        maybeSingle: async () => { const { data, error } = result(); return { data: Array.isArray(data) ? data[0] ?? null : data, error }; },
        then: (resolve: any) => resolve(result()),
      };
      return chain;
    },
  };
}
const ORG = 'org';
const tables = (): Record<string, Row[]> => ({
  opportunity_budget_months: [{ organization_id: ORG, period: '2026-10-01', spent_micro_usd: 18_500_000, reserved_micro_usd: 400_000 }],
  opportunity_budget_reservations: [
    // September: one call never settled still holds its reservation.
    { id: 'r0', organization_id: ORG, period: '2026-09-01', category: 'evaluation', job_id: 'old', state: 'uncertain', cost_micro_usd: null, held_micro_usd: 100_000 },
    { id: 'r1', organization_id: ORG, period: '2026-10-01', category: 'research', job_id: 'job', state: 'settled', cost_micro_usd: 4_000, held_micro_usd: 7_500 },
    { id: 'r2', organization_id: ORG, period: '2026-10-01', category: 'research', job_id: 'job', state: 'reserved', cost_micro_usd: null, held_micro_usd: 7_500 },
    { id: 'r3', organization_id: ORG, period: '2026-10-01', category: 'research', job_id: 'other', state: 'settled', cost_micro_usd: 5_200_000, held_micro_usd: 300_000 },
    { id: 'r4', organization_id: ORG, period: '2026-10-01', category: 'chat', job_id: 'chat', state: 'settled', cost_micro_usd: 90_000, held_micro_usd: 90_000 },
    { id: 'r5', organization_id: 'another', period: '2026-10-01', category: 'research', job_id: 'x', state: 'settled', cost_micro_usd: 900_000, held_micro_usd: 900_000 },
  ],
});

test('what is left of the month, of the reports and of one report, as the database counts it', async () => {
  const room = await opportunityBudgetRoom(memory(tables()), ORG, 'research', 'job', NOW);
  // 20 − 18.5 spent − 0.4 reserved − 0.1 held since September; 6 − (0.004 + 0.0075 + 5.2) of reports; 0.75 − 0.0115 of this one.
  assert.deepEqual(room, { month: 1_000_000, category: 788_500, report: 738_500, period: '2026-10-01' });
  assert.equal((await opportunityBudgetRoom(memory(tables()), ORG, 'chat', 'job', NOW)).report, null, 'only a report has a cap of its own');
});

test('a refusal names the cap it hit and when it renews, in the order the database checks them', () => {
  const room = { month: 1_000_000, category: 788_500, report: 738_500, period: '2026-10-01' };
  assert.equal(budgetRefusalMessage(room, 'research', 1_200_000), 'Oportunidades llegó al tope de US$20 de octubre. Se renueva el 1 de noviembre.');
  assert.equal(budgetRefusalMessage(room, 'research', 800_000), 'Los informes llegaron al tope de US$6 de octubre. Se renueva el 1 de noviembre.');
  assert.equal(budgetRefusalMessage({ ...room, category: 5_000_000 }, 'research', 740_000),
    'Este informe llegó a su tope de US$0,75: sus documentos son demasiado extensos. Quita los que no sean bases ni anexos y vuelve a generarlo.');
  assert.equal(budgetRefusalMessage({ ...room, period: '2026-12-01' }, 'evaluation', 2_000_000),
    'Oportunidades llegó al tope de US$20 de diciembre. Se renueva el 1 de enero.');
  assert.equal(budgetRefusalMessage(room, 'chat', 10_000), null, 'it fits');
});

test('a refused reservation is explained from the tables, and a race or a database that cannot answer asks to try again', async () => {
  const job = { id: 'job', organization_id: ORG };
  assert.match(await budgetRefusal(memory(tables()), job, 'research', 1_200_000, NOW), /^Oportunidades llegó al tope de US\$20 de octubre/);
  for (const client of [memory(tables()), memory(tables(), true)])
    assert.equal(await budgetRefusal(client, job, 'chat', 10_000, NOW), 'Otro trabajo de Oportunidades ocupó lo que quedaba del presupuesto. Vuelve a intentarlo en unos minutos.');
});

test('a report that will not fit says so before reading: too long for one report, or more than what is left this month', async () => {
  assert.ok(reportCostEstimate(20) < 150_000, `a usual tender is a few cents (${reportCostEstimate(20)})`);
  assert.ok(reportCostEstimate(104) < 500_000, `the largest of October fits (${reportCostEstimate(104)})`);
  assert.ok(reportCostEstimate(320) > 750_000, 'some three hundred fragments do not');
  assert.equal(await reportBudgetCheck(memory(tables()), ORG, 320, NOW), REPORT_TOO_LONG);
  assert.equal(await reportBudgetCheck(memory(tables()), ORG, 20, NOW), null);
  const full = tables(); (full.opportunity_budget_months[0] as any).spent_micro_usd = 19_550_000;
  assert.match(await reportBudgetCheck(memory(full), ORG, 20, NOW), /^Oportunidades llegó al tope de US\$20 de octubre/);
  assert.equal(await reportBudgetCheck(memory(full, true), ORG, 20, NOW), null, 'without the tables, the reservations still decide');
});
