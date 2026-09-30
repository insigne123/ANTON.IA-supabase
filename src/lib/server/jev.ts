import { z } from 'zod';

/**
 * Jev (TypeSafe «System One»): answers typed questions about a state with probabilities instead
 * of text. https://docs.typesafe.ai — POST /v1/systemone with Bearer TYPESAFE_API_KEY.
 * Question types: noul (probability that a statement is true), choice (one option of a set) and
 * score (ordered levels). Instructions work best in English; the state can be Spanish.
 *
 * The client fails open: without a key, on a timeout, an HTTP error or an answer it cannot
 * read, it returns no answers and says why, and the caller goes on without Jev. It never logs
 * the key or the state.
 */

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number>; legend?: Record<string, string> };

export type JevStatus = 'ok' | 'timeout' | 'http_error' | 'invalid' | 'disabled';

export type JevResult = {
  status: JevStatus;
  answers: Record<string, JevAnswer> | null;
  model: string | null;
  durationMs: number;
  inputTokens: number;
  /** Input tokens only: output tokens are free. */
  costUsd: number;
  httpStatus?: number;
};

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';
/** USD per million input tokens (docs.typesafe.ai/models, 30 sep 2026). */
const USD_PER_MILLION_INPUT = 0.042;
/** 32k tokens of state: about 60k characters leaves room for the questions. */
export const JEV_STATE_CHARACTERS = 60_000;

const probability = z.number().min(0).max(1);
const answerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: probability }),
  z.object({ type: z.literal('choice'), choice: z.string(), confidence: probability, probabilities: z.record(probability) }),
  z.object({ type: z.literal('score'), score: z.number(), confidence: probability, probabilities: z.record(probability), legend: z.record(z.string()).optional() }),
]);
const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(answerSchema),
  usage: z.object({ input_tokens: z.number().int().min(0).optional(), output_tokens: z.number().int().min(0).optional() }).partial().optional(),
});

/** The state as Jev takes it (a string or a JSON object), clipped to what one request holds. */
export function jevState(state: unknown): string | Record<string, unknown> {
  if (typeof state === 'string') return state.slice(0, JEV_STATE_CHARACTERS);
  const text = JSON.stringify(state ?? null);
  if (text.length <= JEV_STATE_CHARACTERS) return (state && typeof state === 'object' && !Array.isArray(state) ? state : { value: state }) as Record<string, unknown>;
  const cut = '… [recortado]';
  return `${text.slice(0, JEV_STATE_CHARACTERS - cut.length)}${cut}`;
}

export function jevConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.TYPESAFE_API_KEY?.trim());
}

export async function askJev(input: {
  state: unknown;
  questions: Record<string, JevQuestion>;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<JevResult> {
  const env = input.env ?? process.env;
  const started = Date.now();
  const empty = (status: JevStatus, extra: Partial<JevResult> = {}): JevResult =>
    ({ status, answers: null, model: null, durationMs: Date.now() - started, inputTokens: 0, costUsd: 0, ...extra });
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key) return empty('disabled');
  const timeoutMs = input.timeoutMs ?? (Number(env.COWORK_JEV_TIMEOUT_MS) || 3000);
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  try {
    const response = await (input.fetchImpl ?? fetch)(env.TYPESAFE_API_URL?.trim() || DEFAULT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ state: jevState(input.state), model: env.JEV_MODEL?.trim() || DEFAULT_MODEL, questions: input.questions }),
      signal,
    });
    if (!response.ok) return empty('http_error', { httpStatus: response.status });
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return empty('invalid');
    const inputTokens = parsed.data.usage?.input_tokens ?? 0;
    return {
      status: 'ok', answers: parsed.data.answers, model: parsed.data.model ?? null, durationMs: Date.now() - started,
      inputTokens, costUsd: Math.round(inputTokens * USD_PER_MILLION_INPUT) / 1e6,
    };
  } catch (error) {
    // The run itself was cancelled: that is not Jev's failure to hide.
    if (input.signal?.aborted) throw error;
    return empty(deadline.aborted ? 'timeout' : 'http_error');
  }
}
