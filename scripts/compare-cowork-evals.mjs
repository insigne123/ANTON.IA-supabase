// Compares Cowork evaluations side by side: the checks of the corpus, the judge's verdicts, how the AXIS answers stand against
// what the previous AI achieved, how long a turn takes and what it costs in calls. Reads the reports the evaluation and the judge
// write; nothing is called, nothing is written.
//
//   node scripts/compare-cowork-evals.mjs main=main-a.json,main-b.json rama=rama-a.json,rama-b.json [--axis] [--markdown]
//
// Each group is `label=eval1.json,eval2.json,…` (halves of one run can be given together). The judge report of an evaluation is
// the file next to it with `-judge` before the extension (main-a.json → main-a-judge.json); a group without it shows no verdicts.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--')));
const groups = args.filter(arg => !arg.startsWith('--') && arg.includes('=')).map(arg => {
  const [label, files] = [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)];
  return { label, files: files.split(',').filter(Boolean) };
});
if (!groups.length) {
  console.error('Usage: node scripts/compare-cowork-evals.mjs label=eval.json[,eval2.json] [label2=…] [--axis] [--markdown]');
  process.exit(1);
}

const load = file => JSON.parse(readFileSync(file, 'utf8'));
const judgeFile = file => file.replace(/\.json$/, '-judge.json');
const round = (value, digits = 2) => value === null || value === undefined || Number.isNaN(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const pick = (values, fraction) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : null; };
const DIMENSIONS = ['comprension', 'veracidad', 'utilidad', 'claridad', 'friccion'];
const REFERENCE = ['supera', 'iguala', 'por_debajo', 'fuera_de_alcance'];

function summarize({ label, files }) {
  const evals = files.map(load);
  const outcomes = evals.flatMap((report, sourceIndex) => report.outcomes.map(outcome => ({ ...outcome, sourceIndex })));
  const judges = files.flatMap((file, sourceIndex) => existsSync(judgeFile(file)) ? [{ ...load(judgeFile(file)), sourceIndex }] : []);
  const rows = judges.flatMap(report => report.rows.map(row => ({ ...row, sourceIndex: report.sourceIndex })));
  // Attempts restart in separate evaluations: pair a judgement only with the file it belongs to.
  const judged = new Map(rows.map(row => [`${row.sourceIndex}:${row.id}#${row.attempt}`, row]));
  const checks = outcomes.flatMap(outcome => outcome.checks);
  const verdicts = { buena: 0, mejorable: 0, mala: 0 };
  const dims = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, []]));
  for (const row of rows) {
    if (!row.judgement) continue;
    verdicts[row.judgement.veredicto]++;
    for (const dimension of DIMENSIONS) dims[dimension].push(row.judgement.scores[dimension]);
  }
  const reference = Object.fromEntries(REFERENCE.map(verdict => [verdict, rows.filter(row => row.reference?.veredicto === verdict).length]));
  const seconds = outcomes.map(outcome => outcome.seconds);
  const calls = evals.reduce((sum, report) => sum + (report.summary?.calls || 0), 0);
  const tokens = evals.reduce((sum, report) => sum + (report.usage || []).reduce((inner, item) => inner + (item?.totalTokens || 0), 0), 0);
  const perOp = new Map();
  for (const outcome of outcomes) {
    const row = judged.get(`${outcome.sourceIndex}:${outcome.id}#${outcome.attempt}`);
    const op = row?.op || outcome.id;
    const entry = perOp.get(op) || { id: outcome.id, op, block: row?.block || null, capability: row?.capability || null, runs: 0, passed: 0, checks: [0, 0], reference: [], verdicts: [] };
    entry.runs++;
    if (outcome.passed) entry.passed++;
    entry.checks[0] += outcome.checks.filter(check => check.passed).length;
    entry.checks[1] += outcome.checks.length;
    if (row?.reference) entry.reference.push(row.reference.veredicto);
    if (row?.judgement) entry.verdicts.push(row.judgement.veredicto);
    perOp.set(op, entry);
  }
  return {
    label, cases: outcomes.length, casesPassed: outcomes.filter(outcome => outcome.passed).length,
    checks: `${checks.filter(check => check.passed).length}/${checks.length}`,
    checksShare: round(100 * checks.filter(check => check.passed).length / Math.max(1, checks.length), 1),
    failedRuns: outcomes.filter(outcome => outcome.result?.failed).length,
    verdicts, means: Object.fromEntries(DIMENSIONS.map(dimension => [dimension, round(mean(dims[dimension]))])),
    reference, callsPerCase: round(calls / Math.max(1, outcomes.length)), tokens,
    seconds: { p50: pick(seconds, 0.5), p90: pick(seconds, 0.9), mean: round(mean(seconds), 1) },
    perOp: [...perOp.values()],
  };
}

const results = groups.map(summarize);
const cell = (value, fallback = '—') => value === null || value === undefined ? fallback : String(value);

if (flags.has('--markdown')) {
  const header = (title, cols) => `\n${title}\n\n| | ${cols.join(' | ')} |\n|---|${cols.map(() => '---').join('|')}|`;
  const line = (name, fn) => `| ${name} | ${results.map(fn).join(' | ')} |`;
  console.log(header('### Resumen', results.map(result => result.label)));
  console.log(line('Casos con todas sus verificaciones', result => `${result.casesPassed} de ${result.cases}`));
  console.log(line('Verificaciones', result => `${result.checks} (${cell(result.checksShare)} %)`));
  console.log(line('Buenas / mejorables / malas', result => `${result.verdicts.buena} / ${result.verdicts.mejorable} / ${result.verdicts.mala}`));
  console.log(line('Fricción · utilidad · veracidad', result => `${cell(result.means.friccion)} · ${cell(result.means.utilidad)} · ${cell(result.means.veracidad)}`));
  if (flags.has('--axis')) console.log(line('Frente a la IA anterior: supera / iguala / por debajo / fuera de alcance', result => REFERENCE.map(verdict => result.reference[verdict]).join(' / ')));
  console.log(line('Llamadas por caso', result => cell(result.callsPerCase)));
  console.log(line('Turno: mediana · p90', result => `${cell(result.seconds.p50)} · ${cell(result.seconds.p90)} s`));
  if (flags.has('--axis')) {
    console.log(header('### Por operación (verificaciones que pasan · veredicto frente a la IA anterior)', results.map(result => result.label)));
    const ops = [...new Set(results.flatMap(result => result.perOp.map(entry => entry.op)))].sort();
    for (const op of ops) {
      const first = results.flatMap(result => result.perOp).find(entry => entry.op === op);
      console.log(`| ${op}${first?.capability ? ` (${first.capability})` : ''} | ${results.map(result => {
        const entry = result.perOp.find(item => item.op === op);
        return entry ? `${entry.checks[0]}/${entry.checks[1]} · ${entry.reference.length ? [...new Set(entry.reference)].join(', ') : '—'}` : '—';
      }).join(' | ')} |`);
    }
  }
} else {
  for (const result of results) {
    const { perOp, ...rest } = result;
    console.log(JSON.stringify(rest, null, 2));
    if (flags.has('--axis')) for (const entry of perOp) console.log(`  ${entry.op.padEnd(22)} checks ${entry.checks[0]}/${entry.checks[1]} · corridas ok ${entry.passed}/${entry.runs} · frente a la IA anterior: ${entry.reference.join(', ') || '—'} · juez: ${entry.verdicts.join(', ') || '—'}`);
  }
}
