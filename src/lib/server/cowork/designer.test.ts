import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkDesignBrief } from '@/lib/cowork/design-brief';
import { COWORK_ARTIFACT_EXAMPLES, coworkExamplePipeline } from './code-artifact-examples';
import { COWORK_DESIGNER_RULES, coworkDesignerPrompt, runCoworkDesigner, type CoworkDesignerOutput } from './designer';
import { coworkDesignerTurn, type CoworkArtifactStore } from './designer-run';
import type { CoworkCodeArtifact } from './code-artifact';

const brief: CoworkDesignBrief = { title: 'Pipeline por etapa', goal: 'Ver cuántos contactos hay en cada etapa y a quién mover.', tables: ['pipeline'], previous: null, change: null };
const data = coworkExamplePipeline();
const good: CoworkDesignerOutput = {
  title: 'Pipeline por etapa', reply: 'Armé el tablero del pipeline con tus contactos guardados.', ...COWORK_ARTIFACT_EXAMPLES[0].code,
  question: '¿Lo comparo con el mes pasado?', suggestions: [{ label: 'Sí, compáralo', message: 'Sí, compáralo con el mes pasado' }],
};
const bad: CoworkDesignerOutput = { ...good, js: `${good.js}\nfetch('https://example.com');` };

test('the Designer writes the page, and fixes it once with the problems the check found', async () => {
  const calls: Array<{ attempt: number; prompt: string }> = [];
  const made = await runCoworkDesigner({ brief, request: 'muéstrame mi pipeline', data, generatedAt: '2026-10-06T12:00:00Z',
    generate: async ({ attempt, prompt }) => { calls.push({ attempt, prompt }); return attempt === 1 ? bad : good; } });
  assert.equal(made.attempts, 2);
  assert.match(made.html, /antonia-root/);
  const fix = JSON.parse(calls[1].prompt).fix;
  assert.ok(fix.problems.some((problem: string) => /fetch|red|externa/i.test(problem)), fix.problems.join(' | '));
  assert.equal(fix.code.js, bad.js);
  // The first prompt carries the shape of the data, not its rows.
  const first = JSON.parse(calls[0].prompt);
  assert.equal(first.data.pipeline.sample.length, 5);
  assert.equal(first.fix, undefined);
  // Refused twice, or no time for a second try: it throws, and the turn answers without it.
  await assert.rejects(runCoworkDesigner({ brief, request: 'x', data, generate: async () => bad }), /no pasó la revisión/);
  let tries = 0;
  await assert.rejects(runCoworkDesigner({ brief, request: 'x', data, canRetry: () => false, generate: async () => { tries++; return bad; } }), /no pasó la revisión/);
  assert.equal(tries, 1);
});

test('the Designer’s rules forbid figures in the code and the prompt carries the previous version to edit', () => {
  assert.match(COWORK_DESIGNER_RULES, /Nunca escribas en el código una cifra/);
  assert.match(COWORK_DESIGNER_RULES, /stage_order/);
  const previous: CoworkCodeArtifact = { html: '<h1>v1</h1>', css: '', js: 'antonia.mount("#a")' };
  const prompt = JSON.parse(coworkDesignerPrompt({ brief: { ...brief, previous: 'artifact-pipeline-por-etapa-v1.html', change: 'solo minería' }, request: 'solo minería', data, previous }));
  assert.deepEqual(prompt.previous, previous);
  assert.equal(prompt.brief.change, 'solo minería');
});

function memoryStore(previous: Record<string, CoworkCodeArtifact> = {}, versions: Record<string, number> = {}) {
  const saved: Array<{ name: string; code: CoworkCodeArtifact }> = [];
  const recorded: unknown[] = [];
  const store: CoworkArtifactStore = {
    loadData: async () => data,
    loadPrevious: async name => previous[name] ?? null,
    nextVersion: async key => (versions[key] ?? 0) + 1,
    save: async ({ name, html, code }) => { saved.push({ name, code }); return { path: `org/user/run/${name}`, size: html.length }; },
    recordArtifact: async payload => { recorded.push(payload); },
  };
  return { store, saved, recorded };
}

function turnDeps(store: CoworkArtifactStore, output: CoworkDesignerOutput = good) {
  const steps: string[] = [];
  const reserved: string[] = [];
  return {
    steps, reserved,
    deps: {
      request: 'muéstrame mi pipeline', userContext: null, signal: new AbortController().signal, authorize: async () => {},
      reserve: async (role: 'writer') => { reserved.push(role); return 'reservation'; },
      generate: async () => ({ data: output, telemetry: { modelName: 'modelo', durationMs: 10 } }) as never,
      recordUsage: async () => {}, record: async (event: { result: { label: string } }) => { steps.push(event.result.label); },
      timeLeft: () => 90_000, store, now: () => new Date('2026-10-06T12:00:00Z'),
    },
  };
}

test('a new artifact is version 1 of its key: kept as a file of the run, recorded and answered in the chat', async () => {
  const { store, saved, recorded } = memoryStore();
  const { deps, steps, reserved } = turnDeps(store);
  const answer = await coworkDesignerTurn(deps)(brief, []);
  assert.equal(answer.reply, good.reply);
  assert.equal(answer.question, good.question);
  assert.equal(answer.document, null);
  assert.deepEqual(saved.map(file => file.name), ['artifact-pipeline-por-etapa-v1.html']);
  assert.deepEqual(saved[0].code, COWORK_ARTIFACT_EXAMPLES[0].code);
  const payload = recorded[0] as { kind: string; key: string; version: number; path: string; tables: Array<{ name: string; rows: number }> };
  assert.equal(payload.kind, 'code');
  assert.equal(payload.key, 'pipeline-por-etapa');
  assert.equal(payload.version, 1);
  assert.equal(payload.path, 'org/user/run/artifact-pipeline-por-etapa-v1.html');
  assert.deepEqual(payload.tables.map(table => [table.name, table.rows]), [['pipeline', data.tables.pipeline.total]]);
  assert.deepEqual(steps, ['Diseñando «Pipeline por etapa»', 'Listo: «Pipeline por etapa»']);
  assert.deepEqual(reserved, ['writer']);
});

test('a change keeps the key of the previous artifact and makes its next version; an unknown one is refused', async () => {
  const previous = { 'artifact-pipeline-por-etapa-v2.html': COWORK_ARTIFACT_EXAMPLES[0].code };
  const { store, saved } = memoryStore(previous, { 'pipeline-por-etapa': 2 });
  const { deps, steps } = turnDeps(store, { ...good, title: 'Pipeline de minería' });
  await coworkDesignerTurn(deps)({ ...brief, previous: 'artifact-pipeline-por-etapa-v2.html', change: 'solo minería' }, []);
  assert.deepEqual(saved.map(file => file.name), ['artifact-pipeline-por-etapa-v3.html']);
  assert.deepEqual(steps, ['Cambiando «Pipeline por etapa»', 'Versión 3 de «Pipeline de minería»']);
  await assert.rejects(coworkDesignerTurn(deps)({ ...brief, previous: 'artifact-otro-v1.html', change: 'x' }, []), /No encontré el artefacto/);
});

test('without time for the call the Designer does not start it', async () => {
  const { store, saved } = memoryStore();
  const { deps } = turnDeps(store);
  await assert.rejects(coworkDesignerTurn({ ...deps, timeLeft: () => 5_000 })(brief, []), /time exhausted/);
  assert.equal(saved.length, 0);
});
