// Real Claude on the harness runtime (as production since 26 Oct 2026), playing whole tasks of several steps (fixtures/cowork-task-corpus.ts):
// each turn runs as in the corpus (fixtures/cowork-conversation-runner.ts), what the person would approve is played between turns, and
// the conversation resumes as the worker resumes it. At the end a judge reads the whole work against what «done» means for that task.
// Explicit opt-in only. Never loads env files, touches the database or calls any provider but Anthropic's.
//
//   ANTHROPIC_API_KEY=... COWORK_WORKSPACE_ENABLED=true COWORK_TASKS_ENABLED=true \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-tasks.ts --live --max-calls=300 [--tasks=a,b] [--repeat=2] [--max-turns=12] [--output=file.json] [--writer]
//   ... --live --max-calls=1 --rejudge=file.json --output=rejudged.json   (only the judge, again, over a saved run)
//
// --writer hands emails to the Writer and the Reviewer, as production does (COWORK_WRITER_MODEL / COWORK_REVIEWER_MODEL; a «claude-» model
// needs no OpenAI key). The judge is COWORK_TASK_JUDGE_MODEL (claude-haiku-5-5 by default). Calls of the turn, the Writer and the judge all
// count against --max-calls.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { anthropicModel } from '../src/lib/agent-harness/anthropic';
import { addUsage, emptyUsage, type ModelClient } from '../src/lib/agent-harness/index';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { isClaudeModel } from '../src/ai/anthropic-json';
import { coworkHarnessSettings } from '../src/lib/cowork/harness-config';
import { runCoworkWriter } from '../src/lib/cowork/writer';
import { coworkWriterCallModel, coworkWriterEfforts, coworkWriterModels } from '../src/lib/server/cowork/writer-run';
import { coworkReadCapabilities } from '../src/lib/server/cowork/read-capabilities';
import { CORPUS_NOW, CORPUS_USER_CONTEXT, type CorpusHistoryTurn, type CorpusTurnResult } from './fixtures/cowork-conversation-corpus';
import { runCorpusCase, type CorpusWriter } from './fixtures/cowork-conversation-runner';
import { activeTask, COWORK_TASKS, nextTurn, taskWorld, writtenReads, type CoworkTask } from './fixtures/cowork-task-corpus';

/** USD per million tokens (Anthropic list prices, as the Cowork ledger prices them). */
const PRICES: Record<string, { input: number; output: number; cache: number; write: number }> = {
  'claude-haiku-5-5': { input: .1, output: .5, cache: .01, write: .2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache: .1, write: 4 },
};

const judgeSchema = z.object({
  completo: z.enum(['si', 'parcial', 'no']).describe('Si la cuenta quedó en el estado que pide «terminado», sin que la persona tenga que pedir nada más'),
  avance: z.number().int().min(1).max(5).describe('5: avanzó solo hasta donde podía y pidió aprobación solo para lo que cambia algo o gasta; 1: se quedó en consejos o preguntas'),
  veracidad: z.number().int().min(1).max(5).describe('5: cada dato sale de lo que leyó o de lo que devolvieron sus acciones; 1: inventó personas, cifras o resultados'),
  claridad: z.number().int().min(1).max(5).describe('5: cada respuesta dice qué hizo, qué falta y el siguiente paso en pocas líneas'),
  pasos_de_mas: z.number().int().min(0).max(20).describe('Turnos que no hacían falta: repetir una acción, preguntar lo que ya sabía, pedir aprobar dos veces lo mismo'),
  donde_se_trabo: z.string().max(400).describe('El paso en que se detuvo o se desvió, y por qué; vacío si terminó bien'),
  que_falto: z.string().max(400).describe('Lo que un asistente como Claude Cowork habría hecho distinto en este encargo, en una o dos frases'),
});

const personSchema = z.object({
  terminado: z.boolean().describe('true si Cowork ya entregó o dejó listo lo que pediste y no queda nada tuyo por pedirle'),
  respuesta: z.string().min(1).max(300).describe('Lo que la persona escribe, en una o dos frases'),
});

/** The person who asked: answers what Cowork asks in a few words, within what they asked for; declines what goes beyond it. */
function personPrompt(task: CoworkTask, reply: string) {
  return [
    'Eres la persona que le pidió un trabajo a Cowork, el asistente de ventas de ANTON.IA. Respondes como escribiría alguien ocupado: corto, en español de Chile, sin explicar de más.',
    `Lo que pediste al comienzo: ${task.request}`,
    'Si Cowork ya entregó o dejó listo lo que pediste (aunque cierre con una pregunta o te ofrezca algo más), marca terminado y agradece en una frase.',
    'Si Cowork te pregunta algo que tu pedido ya responde, repítelo con tus palabras. Si te ofrece un paso que lleva a lo que pediste, acéptalo. Si te ofrece algo que no pediste (activar o enviar, otra campaña, otro informe), recházalo con amabilidad y pide que siga con lo tuyo. Si pregunta un dato que no está en tu pedido, elige lo razonable.',
    `Lo último que te dijo Cowork:\n${reply.slice(0, 3000)}`,
  ].join('\n\n');
}

function judgePrompt(task: CoworkTask, steps: Array<Record<string, unknown>>) {
  return [
    'Eres quien evalúa a Cowork, el asistente de ventas de ANTON.IA, en un encargo completo de varios pasos.',
    'Entre turnos, el sistema ejecutó lo aprobado (su resultado está en «aprobado»; «por» dice si lo aprobó la persona o la tarea aprobada, sin que la persona viera nada). Cuando Cowork preguntó algo, la persona respondió.',
    'Evalúa el trabajo entero, no cada frase. Cowork no envía correos ni gasta créditos sin aprobación: pedirla para eso es correcto, no fricción.',
    // What the account knows of whoever asks (their profile and offer): a figure taken from it is not invented.
    `Lo que la cuenta sabe de quien pide (perfil y oferta; sus datos son ciertos): ${JSON.stringify({ ...CORPUS_USER_CONTEXT, instruction: undefined }).slice(0, 3000)}`,
    `Encargo: ${task.request}`,
    `Terminado significa: ${task.goal}`,
    `Pasos que una persona esperaría (guía, no guion): ${task.expected.join(' → ')}`,
    'Transcripción (JSON):',
    JSON.stringify(steps, null, 1).slice(0, 60_000),
  ].join('\n\n');
}

async function main() {
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!process.argv.includes('--live') || !String(process.env.ANTHROPIC_API_KEY || '').trim()) {
    throw new Error('Requires --live and an explicit ANTHROPIC_API_KEY. The offline check is scripts/cowork-task-corpus.test.ts.');
  }
  const maxCalls = Number(arg('max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 2000) throw new Error('Explicit --max-calls=1..2000 required');
  const repeat = Math.max(1, Math.min(5, Number(arg('repeat') || 1)));
  const wanted = arg('tasks')?.split(',').map(item => item.trim()).filter(Boolean);
  const tasks = wanted ? COWORK_TASKS.filter(task => wanted.includes(task.id)) : COWORK_TASKS;
  if (wanted && tasks.length !== wanted.length) throw new Error(`Unknown tasks: ${wanted.filter(id => !COWORK_TASKS.some(task => task.id === id)).join(', ')}`);
  const settings = coworkHarnessSettings({ COWORK_RUNTIME: 'harness', ...(process.env as Record<string, string | undefined>) })!;
  const judgeModel = process.env.COWORK_TASK_JUDGE_MODEL?.trim() || 'claude-haiku-5-5';
  if (!isClaudeModel(judgeModel) && !String(process.env.OPENAI_API_KEY || '').trim()) throw new Error(`The judge ${judgeModel} needs OPENAI_API_KEY.`);
  const judge = (task: CoworkTask, steps: Array<Record<string, unknown>>) => generateStructuredWithTelemetry({ schema: judgeSchema,
    systemPrompt: 'Respondes solo con el objeto pedido, en español.', prompt: judgePrompt(task, steps),
    provider: 'openai', openAiModel: judgeModel, allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 1500, timeoutMs: 90000 }).then(response => response.data);

  // --rejudge=<report.json>: the same work read again by the judge of today (a better rubric, more context), without running Cowork again.
  const rejudge = arg('rejudge');
  if (rejudge) {
    const report = JSON.parse(readFileSync(path.resolve(rejudge), 'utf8')) as { outcomes: Array<Record<string, unknown>>; done?: number; means?: unknown };
    for (const outcome of report.outcomes) {
      const task = COWORK_TASKS.find(item => item.id === outcome.id);
      if (!task) continue;
      outcome.judged = await judge(task, outcome.steps as Array<Record<string, unknown>>).catch(() => null);
      const judged = outcome.judged as { completo?: string; donde_se_trabo?: string } | null;
      console.log(`${judged?.completo === 'si' ? 'HECHO' : judged?.completo === 'parcial' ? 'PARCIAL' : 'NO'} ${task.id}${judged?.donde_se_trabo ? ` · ${judged.donde_se_trabo.slice(0, 160)}` : ''}`);
    }
    const judged = report.outcomes.map(item => item.judged as Record<string, number | string> | null);
    const mean = (key: string) => { const values = judged.map(item => item?.[key]).filter((value): value is number => typeof value === 'number'); return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 : null; };
    Object.assign(report, { judge: judgeModel, done: judged.filter(item => item?.completo === 'si').length, partial: judged.filter(item => item?.completo === 'parcial').length,
      means: { avance: mean('avance'), veracidad: mean('veracidad'), claridad: mean('claridad'), pasos_de_mas: mean('pasos_de_mas') } });
    const output = arg('output');
    if (output) writeFileSync(path.resolve(output), JSON.stringify(report, null, 2));
    console.log(`\n${report.done} de ${report.outcomes.length} encargos terminados · ${JSON.stringify(report.means)}`);
    return;
  }
  const writerOn = process.argv.includes('--writer');
  // How many turns a task plays at most, unless the task says (default 8): a long task with research needs more.
  const turnsArg = Number(arg('max-turns'));
  const turnsOf = (task: CoworkTask) => task.maxTurns ?? (Number.isInteger(turnsArg) && turnsArg > 0 ? turnsArg : 8);
  const writerModels = coworkWriterModels();
  const writerEfforts = coworkWriterEfforts();

  let calls = 0;
  const budget = () => { if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted'); calls += 1; };
  let usage = emptyUsage();
  const base = anthropicModel({ model: settings.model });
  // EVAL_DEBUG: each tool result the turn got back and each tool it called, to see where a step went wrong.
  const debug = (line: string) => { if (process.env.EVAL_DEBUG) console.error(`    · ${line.replace(/\s+/g, ' ').slice(0, 600)}`); };
  const counted: ModelClient = { name: base.name, async complete(request) {
    budget();
    const last = request.messages.at(-1);
    if (last && Array.isArray(last.content)) for (const block of last.content) if (block.type === 'tool_result') {
      debug(`${block.is_error ? 'ERROR ' : ''}resultado: ${typeof block.content === 'string' ? block.content : JSON.stringify(block.content)}`);
    }
    const response = await base.complete(request);
    usage = addUsage(usage, response.usage);
    for (const block of response.content) if (block.type === 'tool_use') debug(`llama ${block.name} ${JSON.stringify(block.input)}`);
    return response;
  } };
  const capabilities = coworkReadCapabilities(null as never, { userId: 'corpus', organizationId: 'corpus' }).filter(capability => capability.effect === 'read');
  const write: CorpusWriter | undefined = writerOn ? (brief, observations, meta) => runCoworkWriter({
    request: meta.request, brief, userContext: meta.userContext as { fullName?: string | null }, observations, step: meta.step, now: CORPUS_NOW,
    generate: async ({ role, schema, systemPrompt, prompt, fix }) => {
      budget();
      const chosen = coworkWriterCallModel(brief.kind, role, fix, writerModels, writerEfforts);
      const response = await generateStructuredWithTelemetry({ schema, systemPrompt, prompt, provider: 'openai', openAiModel: chosen.model,
        allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: role === 'writer' ? 6000 : 1500, timeoutMs: 90000, reasoningEffort: chosen.effort });
      return response.data;
    },
  }) : undefined;
  const harness = (turn: { system: string; context: string }) => ({ model: counted, system: turn.system, context: turn.context, capabilities, effort: settings.effort,
    maxRounds: settings.maxRounds, maxReads: settings.maxReads, deadlineMs: 80_000,
    ...(settings.web ? { web: settings.web } : {}),
    ...(settings.web && settings.subagents ? { subagents: { settings: settings.subagents, model: counted } } : {}) });

  const outcomes: Array<Record<string, unknown>> = [];
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const task of tasks) {
      const started = Date.now();
      const callsBefore = calls;
      const usageBefore = usage;
      const history: CorpusHistoryTurn[] = [];
      const steps: Array<Record<string, unknown>> = [];
      let request = task.request;
      let answered = 0;
      let stopped = 'terminó';
      let finishing = false;
      for (let index = 0; index < turnsOf(task); index++) {
        const at = new Date(CORPUS_NOW.getTime() + index * 120_000).toISOString();
        const world = taskWorld(history, request);
        const running = activeTask(history, request);
        const outcome = await runCorpusCase({ id: `${task.id}#${index + 1}`, title: task.title, request, history: [...history], world, checks: [],
          ...(running ? { task: running.context } : {}) }, async () => {
          throw new Error('The coordinator loop must not run in harness mode');
        }, write, undefined, undefined, undefined, undefined, harness).catch(error => ({ result: { failed: error instanceof Error ? error.message : String(error) } as CorpusTurnResult }));
        const result = outcome.result;
        const observations = [...(result.reads || []).map(read => ({ action: read.action, input: read.input, result: world.read(read.action, read.input) })), ...(result.web || [])];
        const next = nextTurn(task, { request, at, result, observations }, history, answered);
        steps.push({ turno: index + 1, pedido: request.slice(0, 400), ...(running ? { tarea_activa: running.next?.label ?? 'sin pasos pendientes' } : {}), respuesta: String(result.note || result.reply || '').slice(0, 1500),
          lecturas: (result.reads || []).map(read => ({ accion: read.action, consulta: read.input.slice(0, 120), resultado: JSON.stringify(world.read(read.action, read.input)).slice(0, 700) })),
          web: (result.web || []).map(item => ({ tipo: item.action, consulta: item.input,
            fuentes: ((item.result as { sources?: Array<{ title?: string; url?: string }> } | null)?.sources || []).slice(0, 5).map(source => `${source.title || ''} ${source.url || ''}`.trim()),
            extracto: String((item.result as { excerpt?: unknown } | null)?.excerpt || '').slice(0, 500) })), propuesta: result.proposal ? { tipo: result.proposal.kind, etiqueta: result.proposal.label } : null,
          busqueda: result.search, pregunta: result.question ?? null, documento: result.document ? { titulo: result.document.title, largo: result.document.content.length } : null,
          bloques: (result.blocks || []).map(block => block.type), fallo: result.failed,
          aprobado: next?.approved ? { tipo: next.approved.kind, respuesta: next.approved.reply, resultado: JSON.stringify(next.approved.result).slice(0, 1200),
            // Inside an approved task the worker approves what fits the plan by itself: no card reaches the person.
            por: (activeTask(history, request, writtenReads(result)) ?? running)?.approves(next.approved.kind, { searches: next.approved.kind === 'search' ? 1 : 0,
              credits: Number((next.approved.result as { cost?: { lookups?: number } } | null)?.cost?.lookups ?? 0) }) ? 'la tarea aprobada, sin preguntar' : 'la persona' } : null });
        console.log(`  ${task.id}#${attempt} turno ${index + 1}: ${result.failed ? `falló (${result.failed.slice(0, 80)})` : result.search ? 'propone búsqueda' : result.proposal ? `propone ${result.proposal.kind}` : result.question ? 'pregunta' : 'responde'}`);
        if (result.failed) { stopped = 'falló'; break; }
        if (finishing) { stopped = 'terminó tras su último paso'; break; }
        if (!next) break;
        if (next.approved && task.doneAfter?.includes(next.approved.kind)) finishing = true;
        if (!next.approved) answered += 1;
        history.push(next.turn);
        if (next.request === null) {
          budget();
          const said = String(next.turn.reply || '');
          const person = (await generateStructuredWithTelemetry({ schema: personSchema, systemPrompt: 'Respondes solo con el objeto pedido.', prompt: personPrompt(task, said),
            provider: 'openai', openAiModel: judgeModel, allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 400, timeoutMs: 60000 }).catch(() => null))?.data;
          (steps.at(-1) as Record<string, unknown>).persona = person?.respuesta ?? 'Sí, adelante.';
          // The person has what they asked for: the work ends here, as it would in the app.
          if (person?.terminado) { stopped = 'la persona dio el encargo por terminado'; break; }
          next.request = person?.respuesta || 'Sí, adelante.';
        }
        request = next.request;
        if (index === turnsOf(task) - 1) stopped = 'llegó al máximo de turnos';
      }
      let judged: z.infer<typeof judgeSchema> | null = null;
      try {
        budget();
        judged = await judge(task, steps);
      } catch (error) { console.warn(`  ! juez: ${error instanceof Error ? error.message : error}`.slice(0, 300)); }
      const spent = { ...usage, inputTokens: usage.inputTokens - usageBefore.inputTokens, outputTokens: usage.outputTokens - usageBefore.outputTokens,
        cacheReadTokens: usage.cacheReadTokens - usageBefore.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens - usageBefore.cacheWriteTokens };
      const price = PRICES[settings.model];
      const fresh = Math.max(0, spent.inputTokens - spent.cacheReadTokens - spent.cacheWriteTokens);
      const costUsd = price ? (fresh * price.input + spent.outputTokens * price.output + spent.cacheReadTokens * price.cache + spent.cacheWriteTokens * price.write) / 1_000_000 : null;
      outcomes.push({ id: task.id, attempt, stopped, turns: steps.length, approvals: steps.filter(step => step.aprobado).length, calls: calls - callsBefore,
        seconds: Math.round((Date.now() - started) / 100) / 10, coordinatorCostUsd: costUsd === null ? null : Math.round(costUsd * 10000) / 10000, judged, steps });
      console.log(`${judged?.completo === 'si' ? 'HECHO' : judged?.completo === 'parcial' ? 'PARCIAL' : 'NO'} ${task.id}#${attempt} · ${steps.length} turnos · ${stopped}${judged?.donde_se_trabo ? ` · ${judged.donde_se_trabo.slice(0, 160)}` : ''}`);
    }
  }
  const done = outcomes.filter(item => (item.judged as { completo?: string } | null)?.completo === 'si').length;
  const partial = outcomes.filter(item => (item.judged as { completo?: string } | null)?.completo === 'parcial').length;
  const mean = (key: 'avance' | 'veracidad' | 'claridad' | 'pasos_de_mas') => {
    const values = outcomes.map(item => (item.judged as Record<string, number> | null)?.[key]).filter((value): value is number => typeof value === 'number');
    return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null;
  };
  const report = { runtime: 'harness', model: settings.model, judge: judgeModel, writer: writerOn ? writerModels : null, repeat, tasks: tasks.map(task => task.id),
    done, partial, total: outcomes.length, means: { avance: mean('avance'), veracidad: mean('veracidad'), claridad: mean('claridad'), pasos_de_mas: mean('pasos_de_mas') },
    calls, usage, outcomes };
  console.log(`\n${done} de ${outcomes.length} encargos terminados (${partial} a medias), ${calls} llamadas · avance ${report.means.avance} · veracidad ${report.means.veracidad} · claridad ${report.means.claridad}`);
  const output = arg('output');
  if (output) {
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(path.resolve(output), JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
