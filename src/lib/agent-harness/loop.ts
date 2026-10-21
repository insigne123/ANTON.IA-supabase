// The agent loop: the model answers or asks for tools, the harness runs them and hands the results back, until the model finishes.
// It is the part of Claude Code that does the work: observations are real (a failed lookup comes back as a result the model reads
// and corrects), several tools can be asked at once, a long run makes room for itself, and a finished answer can be sent back once
// by a reviewer. Everything the product decides (who may do what, what a call costs, what is shown) enters through hooks.
import { z } from 'zod';
import { clearOldToolResults, estimateTokens, summarizeOldTurns } from './context';
import { renderToolOutput, searchToolsTool, summarizeOutcome, ToolRegistry, toolSpec, inputProblems } from './tools';
import {
  addUsage, emptyUsage, type AgentEvent, type AgentRun, type AgentStopReason, type AgentTool, type ContentBlock, type Effort, type Message,
  type ModelClient, type ModelResponse, type ToolContext, type ToolOutcome, type ToolResultBlock, type ToolUseBlock, type Usage,
} from './types';

export type AgentLimits = {
  /** Calls to the model. Each round can ask for several tools at once, so a few rounds do a lot. */
  maxRounds: number;
  /** Tool calls in the whole run (default: unbounded). */
  maxToolCalls?: number;
  /** After this long the run wraps up: the next call has to answer. */
  deadlineMs?: number;
  maxTokens?: number;
  /** Tools that run at the same time (default 5). */
  concurrency?: number;
};

export type ReviewInfo = { round: number; output: unknown; text: string; via: 'final_tool' | 'end_turn'; messages: Message[] };

export type AgentHooks = {
  /** Before each call to the model: reserve its budget, check access. Throwing ends the run with that error. */
  beforeModelCall?: (info: { round: number; messages: Message[] }) => Promise<void>;
  /** After each call: record what it cost. */
  afterModelCall?: (info: { round: number; response: ModelResponse; model: string }) => Promise<void>;
  /** Before a tool runs: return an outcome to answer instead of running it (approval policy, access), or nothing to let it run. */
  beforeTool?: (info: { tool: AgentTool; input: unknown; round: number }) => Promise<ToolOutcome | void>;
  afterTool?: (info: { tool: AgentTool; input: unknown; outcome: ToolOutcome; round: number; ms: number }) => Promise<void>;
  /**
   * The answer is about to be accepted (the model closed, or called the final tool). Return what is wrong with it and the model
   * gets one more turn to fix it; return null to accept. At most `maxReviews` times, and never on the last round.
   */
  review?: (info: ReviewInfo) => Promise<string | null>;
};

export type CompactionOptions = {
  /** Estimated tokens above which the oldest tool results are cleared. */
  clearAt: number;
  /** Above this, the oldest turns are summarized. */
  summarizeAt: number;
  /** Tool results kept whole when clearing, and messages kept whole when summarizing. */
  keepResults?: number;
  keepMessages?: number;
  summarize?: (transcript: string) => Promise<string>;
};

export type RunAgentInput = {
  model: ModelClient;
  system: string;
  messages: Message[];
  registry: ToolRegistry;
  /** The tool whose `final` outcome is the run's answer. On the last round the model is forced to call it. */
  finalTool?: string;
  limits: AgentLimits;
  effort?: Effort;
  signal: AbortSignal;
  hooks?: AgentHooks;
  compaction?: CompactionOptions;
  maxReviews?: number;
  onEvent?: (event: AgentEvent) => void;
  /** Clock, injectable in tests. */
  now?: () => number;
  /** Sub-agents depth, for the tools' context. */
  depth?: number;
  state?: Map<string, unknown>;
};

const DEFAULT_CONCURRENCY = 5;

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

const textOf = (content: ContentBlock[]) => content.filter(block => block.type === 'text').map(block => (block as { text: string }).text).join('').trim();

function isAbort(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export async function runAgent(input: RunAgentInput): Promise<AgentRun> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const emit = (event: AgentEvent) => { try { input.onEvent?.(event); } catch { /* a listener never breaks a run */ } };
  const registry = input.registry;
  if (registry.deferredCount() > 0 && !registry.get('buscar_herramientas')) registry.add(searchToolsTool(registry));

  let messages = [...input.messages];
  let usage: Usage = emptyUsage();
  let toolCalls = 0;
  /** What counts against `maxToolCalls`: reads and effects. The harness's own tools and the answer never do. */
  let budgeted = 0;
  let reviews = 0;
  const models: string[] = [];
  const state = input.state ?? new Map<string, unknown>();
  const concurrency = input.limits.concurrency ?? DEFAULT_CONCURRENCY;
  const maxReviews = input.maxReviews ?? 1;
  const late = () => input.limits.deadlineMs !== undefined && now() - startedAt >= input.limits.deadlineMs;
  const done = (round: number, stopReason: AgentStopReason, output: unknown, text: string): AgentRun =>
    ({ output, text, stopReason, rounds: round, toolCalls, usage, messages, models });

  const compact = async () => {
    const options = input.compaction;
    if (!options) return;
    const size = () => estimateTokens(messages, input.system);
    let before = size();
    if (before >= options.clearAt) {
      const result = clearOldToolResults(messages, options.keepResults ?? 6);
      if (result.cleared) { messages = result.messages; emit({ type: 'compact', before, after: size(), method: 'clear' }); }
    }
    before = size();
    if (before >= options.summarizeAt && options.summarize) {
      try {
        const result = await summarizeOldTurns(messages, options.keepMessages ?? 8, options.summarize);
        if (result) { messages = result.messages; emit({ type: 'compact', before, after: size(), method: 'summary' }); }
      } catch (error) {
        if (isAbort(error) || input.signal.aborted) throw error;
        // A summary that fails leaves the conversation as it was.
      }
    }
  };

  for (let round = 1; round <= input.limits.maxRounds; round++) {
    input.signal.throwIfAborted();
    emit({ type: 'round', round });
    const lastRound = round === input.limits.maxRounds || late()
      || (input.limits.maxToolCalls !== undefined && budgeted >= input.limits.maxToolCalls);
    await compact();
    await input.hooks?.beforeModelCall?.({ round, messages });
    input.signal.throwIfAborted();

    const active = registry.active();
    const forcedFinal = lastRound && input.finalTool && registry.get(input.finalTool) ? input.finalTool : null;
    const response = await input.model.complete({
      system: input.system, messages, tools: (forcedFinal ? active.filter(tool => tool.name === forcedFinal) : active).map(toolSpec),
      toolChoice: forcedFinal ? { type: 'tool', name: forcedFinal } : lastRound ? { type: 'none' } : undefined,
      effort: input.effort, maxTokens: input.limits.maxTokens, signal: input.signal,
      onText: (delta, snapshot) => emit({ type: 'text', delta, snapshot }),
    });
    usage = addUsage(usage, response.usage);
    if (!models.includes(response.model)) models.push(response.model);
    emit({ type: 'usage', usage: response.usage, model: response.model });
    await input.hooks?.afterModelCall?.({ round, response, model: response.model });
    messages = [...messages, { role: 'assistant', content: response.content }];

    if (response.stopReason === 'refusal') throw new Error('AGENT_REFUSAL: the model declined this request.');
    const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === 'tool_use');

    // A call cut by the output limit has a half-written input: it is answered with the problem instead of being run.
    if (response.stopReason === 'max_tokens') {
      if (!toolUses.length) {
        const text = textOf(response.content);
        if (!text) throw new Error('AGENT_MAX_TOKENS: the answer did not fit in max_tokens.');
        return done(round, 'end_turn', text, text);
      }
      messages = [...messages, { role: 'user', content: toolUses.map((use): ToolResultBlock => ({ type: 'tool_result', tool_use_id: use.id, is_error: true,
        content: 'Tu llamada se cortó por el límite de salida: vuelve a hacerla más corta.' })) }];
      continue;
    }

    if (!toolUses.length) {
      const text = textOf(response.content);
      if (input.hooks?.review && reviews < maxReviews && !lastRound) {
        const feedback = await input.hooks.review({ round, output: text, text, via: 'end_turn', messages });
        emit({ type: 'review', feedback });
        if (feedback) {
          reviews += 1;
          messages = [...messages, { role: 'user', content: feedback }];
          continue;
        }
      }
      return done(round, 'end_turn', text, text);
    }

    const context: ToolContext = { signal: input.signal, round, depth: input.depth ?? 0, state, note: message => emit({ type: 'note', message }) };
    const results = new Map<string, ToolOutcome & { ms: number }>();
    const runOne = async (use: ToolUseBlock): Promise<void> => {
      const tool = registry.get(use.name);
      const started = now();
      const finish = (outcome: ToolOutcome) => {
        const ms = now() - started;
        results.set(use.id, { ...outcome, ms });
        emit({ type: 'tool_end', round, id: use.id, name: use.name, status: outcome.status, ms, summary: summarizeOutcome(outcome) });
      };
      emit({ type: 'tool_start', round, id: use.id, name: use.name, input: use.input });
      if (!tool || !registry.isLoaded(use.name)) {
        finish({ status: 'error', message: tool ? `La herramienta ${use.name} aún no está cargada: búscala con buscar_herramientas.` : `No existe la herramienta ${use.name}.` });
        return;
      }
      const counts = tool.kind !== 'meta' && use.name !== input.finalTool;
      if (counts && input.limits.maxToolCalls !== undefined && budgeted >= input.limits.maxToolCalls) {
        finish({ status: 'error', message: 'Se agotó el presupuesto de consultas de este trabajo: responde con lo que ya tienes.' });
        return;
      }
      toolCalls += 1;
      if (counts) budgeted += 1;
      const parsed = tool.schema.safeParse(use.input);
      if (!parsed.success) { finish({ status: 'error', message: `La entrada de ${use.name} no cumple el formato:\n${inputProblems(parsed.error)}\nCorrígela y vuelve a llamarla.` }); return; }
      try {
        const blocked = await input.hooks?.beforeTool?.({ tool, input: parsed.data, round });
        if (blocked) { finish(blocked); return; }
        const outcome = await tool.run(parsed.data, context);
        finish(outcome);
        await input.hooks?.afterTool?.({ tool, input: parsed.data, outcome, round, ms: now() - started });
      } catch (error) {
        if (isAbort(error) || input.signal.aborted) throw error;
        const status = (error as { status?: number }).status;
        // Access errors end the run: the model cannot fix them. Anything else is a result it can read.
        if (error instanceof Error && (error.name === 'AuthError' || status === 401 || status === 403)) throw error;
        finish({ status: 'error', message: `${use.name} falló: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` });
      }
    };

    // Reads and the harness's own tools go together; whatever changes something goes one at a time, in the order asked, after them.
    const sequential = toolUses.filter(use => registry.get(use.name)?.kind === 'effect');
    const parallel = toolUses.filter(use => !sequential.includes(use) && registry.get(use.name)?.kind !== 'effect');
    const finals = parallel.filter(use => use.name === input.finalTool);
    const readers = parallel.filter(use => !finals.includes(use));
    await pool(readers, concurrency, runOne);
    for (const use of sequential) { input.signal.throwIfAborted(); await runOne(use); }
    for (const use of finals) await runOne(use);

    const blocks: ToolResultBlock[] = [];
    let final: { output: unknown; text?: string } | null = null;
    for (const use of toolUses) {
      const outcome = results.get(use.id)!;
      if (outcome.status === 'final' && !final) final = { output: outcome.output, text: outcome.text };
      const images = outcome.status === 'ok' ? outcome.images : undefined;
      const text = renderToolOutput(outcome);
      blocks.push({ type: 'tool_result', tool_use_id: use.id, is_error: outcome.status === 'error' ? true : undefined,
        content: images?.length ? [{ type: 'text', text }, ...images] : text });
    }

    if (final) {
      // Only the answer is reviewed: a proposal that waits for the person's approval is that approval's to judge.
      const answer = toolUses.find(use => use.name === input.finalTool && results.get(use.id)?.status === 'final');
      if (answer && input.hooks?.review && reviews < maxReviews && !lastRound) {
        const feedback = await input.hooks.review({ round, output: final.output, text: final.text ?? '', via: 'final_tool', messages });
        emit({ type: 'review', feedback });
        if (feedback) {
          reviews += 1;
          // The answer is held back: its tool call is answered with what to fix, and the model calls the tool again.
          const held = blocks.map(block => (block.tool_use_id === answer.id
            ? { ...block, is_error: true as const, content: `La respuesta no se entregó todavía. ${feedback}\nCorrígela y vuelve a llamar ${input.finalTool}.` } : block));
          messages = [...messages, { role: 'user', content: held }];
          continue;
        }
      }
      messages = [...messages, { role: 'user', content: blocks }];
      return done(round, 'final_tool', final.output, final.text ?? '');
    }
    messages = [...messages, { role: 'user', content: blocks }];
  }

  const last = [...messages].reverse().find(message => message.role === 'assistant');
  const text = last && typeof last.content !== 'string' ? textOf(last.content) : '';
  return done(input.limits.maxRounds, 'max_rounds', text, text);
}

/** Convenience for tools that wrap a sub-run: a zod object for the common `{ task }` input. */
export const taskInput = z.object({ task: z.string().min(3).max(4_000) });
