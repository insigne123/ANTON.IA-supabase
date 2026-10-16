import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

// The specialist team with the model in memory: who reads, what each one is asked, and that one failure is left out.
async function load() {
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-specialists';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /\.\/workspace-ai$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export async function opportunityGenerate(){ throw new Error("injected") }' }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

const input = { kind: 'tender', title: 'Seguridad Museo', buyer: 'Corporación Cultural', deadline: '2026-10-29T12:00:00Z', offer: 'Guardias y monitoreo',
  facts: [{ text: 'Garantía de seriedad de $500.000 con vigencia de 60 días.', state: 'documented' }], missing: ['Monto estimado'] };

test('a tender is read by four specialists and a planner, in parallel, each with its own step; one failure is left out', async () => {
  const { runOpportunitySpecialists } = await load();
  const calls: Array<{ step: string; role: string; prompt: string }> = [];
  const generate = async (_client: unknown, _job: unknown, call: any) => {
    calls.push({ step: call.step, role: call.role, prompt: call.prompt });
    if (call.step.startsWith('specialist:puntaje')) throw new Error('model timeout');
    if (call.step.startsWith('route:')) return { steps: [{ title: 'Pedir la garantía', detail: 'Al banco', date: 'Esta semana', kind: 'prepare' }] };
    return { findings: ['La garantía de seriedad es de $500.000.'], advice: ['Pedirla esta semana.'], missing: [] };
  };
  const review = await runOpportunitySpecialists({}, { id: 'j' }, input, generate);
  assert.deepEqual(calls.map(c => c.step.split(':')[0] + ':' + c.step.split(':')[1]).sort(),
    ['route:' + calls.find(c => c.step.startsWith('route:'))!.step.split(':')[1], 'specialist:contrato', 'specialist:estrategia', 'specialist:puntaje', 'specialist:requisitos'].sort());
  assert.ok(calls.every(c => c.role === 'specialist'), 'Haiku, not the writer');
  assert.deepEqual(review.notes.map((n: any) => n.name), ['Requisitos y documentos', 'Contrato y garantías', 'Estrategia y precio']);
  assert.equal(review.route.steps[0].title, 'Pedir la garantía');
  assert.match(calls[0].prompt, /Garantía de seriedad de \$500\.000/);
  assert.match(calls[0].prompt, /No inventes montos/);
  // The same facts, the same steps: a later tick gets the paid answers back instead of paying again.
  const again: string[] = [];
  await runOpportunitySpecialists({}, { id: 'j' }, input, async (_c: unknown, _j: unknown, call: any) => { again.push(call.step); return call.step.startsWith('route:') ? { steps: [] } : { findings: [], advice: [], missing: [] }; });
  assert.deepEqual(again.sort(), calls.map(c => c.step).sort());
});

test('a LinkedIn signal gets its own team, and a planner that fails leaves the route to the dates', async () => {
  const { runOpportunitySpecialists } = await load();
  const steps: string[] = [];
  const review = await runOpportunitySpecialists({}, { id: 'j' }, { ...input, kind: 'hiring' }, async (_c: unknown, _j: unknown, call: any) => {
    steps.push(call.step);
    if (call.step.startsWith('route:')) throw new Error('invalid');
    return { findings: ['Abrió 12 vacantes de bodega en un mes.'], advice: [], missing: [] };
  });
  assert.deepEqual(steps.filter(s => s.startsWith('specialist:')).map(s => s.split(':')[1]).sort(), ['contacto', 'empresa', 'validar']);
  assert.equal(review.route, null);
  assert.equal(review.notes.length, 3);
});

test('the facts the team reads stay small enough for one Haiku call', async () => {
  const { specialistFacts } = await load();
  const many = Array.from({ length: 500 }, (_, i) => ({ text: `Hecho ${i} `.repeat(80), state: 'documented' }));
  const kept = specialistFacts(many);
  assert.ok(kept.length < many.length);
  assert.ok(JSON.stringify(kept).length < 75_000);
  assert.ok(kept.every((f: any) => f.text.length <= 600));
});
