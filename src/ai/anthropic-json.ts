import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Structured generation with Claude (Anthropic Messages API, official SDK). openai-json.ts sends here every
 * model whose name starts with «claude-», so a role picks Claude or OpenAI with its model variable alone
 * (COWORK_WRITER_MODEL=claude-haiku-5-5). Same contract as the OpenAI path: the schema's JSON, its telemetry
 * with the usage in the shape coworkModelUsage reads, and the same errors for retries and empty credits.
 */

export type StructuredEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function isClaudeModel(model: string | null | undefined) {
  return /^claude-/i.test(String(model || '').trim());
}

/** Claude has no «none»: it is its lowest level. Without an effort, «low», the default of the OpenAI path for gpt-6. */
export function claudeEffort(effort?: StructuredEffort | null): ClaudeEffort {
  return !effort || effort === 'none' ? 'low' : effort;
}

/** Thinking spends output tokens before the JSON: each level gets room for it on top of the answer's own limit. */
const THINKING_ROOM: Record<ClaudeEffort, number> = { low: 4000, medium: 8000, high: 16000, xhigh: 24000, max: 32000 };

const UNSUPPORTED_KEYWORDS = new Set([
  '$schema', 'default', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'pattern', 'minProperties', 'maxProperties',
]);
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

/** The schema's JSON for structured outputs: every object closed and without the constraints the API does not
 * take (lengths, ranges, item counts). The answer is still validated with the full schema afterwards. */
export function claudeJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => !UNSUPPORTED_KEYWORDS.has(key) && !(key === 'format' && !SUPPORTED_FORMATS.has(String(item))))
      .map(([key, item]) => [key, key === 'properties'
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, property]) => [name, clean(property)]))
        : clean(item)]);
    const node = Object.fromEntries(entries) as Record<string, unknown>;
    if (node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object')) || node.properties) node.additionalProperties = false;
    return node;
  };
  return clean(zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' })) as Record<string, unknown>;
}

type ClaudeUsage = {
  input_tokens?: number | null; output_tokens?: number | null;
  cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null;
};

/** Claude's usage in the shape of the OpenAI path (prompt, completion and cached tokens), so the ledger and the
 * reports price it the same way. Thinking is already part of output_tokens. */
export function claudeUsage(usage: ClaudeUsage | null | undefined) {
  const input = usage?.input_tokens ?? 0;
  const written = usage?.cache_creation_input_tokens ?? 0;
  const read = usage?.cache_read_input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const prompt = input + written + read;
  return {
    prompt_tokens: prompt, completion_tokens: output, total_tokens: prompt + output,
    prompt_tokens_details: { cached_tokens: read }, cache_creation_input_tokens: written, provider: 'anthropic',
  };
}

export type ClaudeStructuredOptions<T extends z.ZodTypeAny> = {
  model: string;
  prompt: string;
  systemPrompt?: string;
  schema: T;
  maxOutputTokens?: number;
  reasoningEffort?: StructuredEffort | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  onPartial?: (content: string) => void;
};

/** The request: the JSON format, the effort and room for thinking. Thinking stays as the model has it by default
 * (adaptive on the current models); no sampling parameters, which they reject. */
export function claudeRequest<T extends z.ZodTypeAny>(opts: ClaudeStructuredOptions<T>) {
  const effort = claudeEffort(opts.reasoningEffort);
  return {
    model: opts.model,
    max_tokens: (opts.maxOutputTokens ?? 6000) + THINKING_ROOM[effort],
    ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
    messages: [{ role: 'user' as const, content: opts.prompt }],
    output_config: { effort, format: { type: 'json_schema' as const, schema: claudeJsonSchema(opts.schema) } },
  };
}

type ClaudeMessage = {
  model?: string;
  stop_reason?: string | null;
  content: Array<{ type: string; text?: string }>;
  usage?: ClaudeUsage | null;
};
type ClaudeStream = {
  on: (event: 'text', listener: (delta: string, snapshot: string) => void) => unknown;
  finalMessage: () => Promise<ClaudeMessage>;
};
export type ClaudeClient = { messages: { stream: (params: ReturnType<typeof claudeRequest>, options: { signal?: AbortSignal }) => ClaudeStream } };

let defaultClient: ClaudeClient | null = null;
function claudeClient(): ClaudeClient {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('Missing AI provider credentials. Set ANTHROPIC_API_KEY to use Claude.');
  // Retries belong to the caller (openai-json.ts), the same for both providers.
  defaultClient ??= new Anthropic({ apiKey, maxRetries: 0 }) as unknown as ClaudeClient;
  return defaultClient;
}

/** The SDK's errors as the OpenAI path writes them, so the same checks retry a 429 and stop at empty credits. */
function providerError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const detail = String(error.message || '').slice(0, 400);
    const credits = /credit balance is too low/i.test(detail) ? ' credit_balance_exhausted' : '';
    return new Error(`CLAUDE_HTTP_${error.status ?? 'error'}:${detail}${credits}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function generateClaudeStructured<T extends z.ZodTypeAny>(
  opts: ClaudeStructuredOptions<T>,
  client: ClaudeClient = claudeClient(),
): Promise<{ data: z.infer<T>; telemetry: { modelName: string; requestedModel: string; usage: Record<string, unknown>; durationMs: number } }> {
  const startedAt = Date.now();
  const timeoutController = opts.timeoutMs === undefined ? undefined : new AbortController();
  const signal = timeoutController
    ? (opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal)
    : opts.signal;
  const timeout = timeoutController && setTimeout(
    () => timeoutController.abort(new DOMException('Structured generation timed out.', 'TimeoutError')), opts.timeoutMs);
  try {
    signal?.throwIfAborted();
    let message: ClaudeMessage;
    try {
      const stream = client.messages.stream(claudeRequest(opts), { signal });
      if (opts.onPartial) {
        const onPartial = opts.onPartial;
        // A live preview never breaks the answer.
        stream.on('text', (_delta, snapshot) => { try { onPartial(snapshot); } catch { /* ignored */ } });
      }
      message = await stream.finalMessage();
    } catch (error) {
      signal?.throwIfAborted();
      throw providerError(error);
    }
    const telemetry = {
      modelName: typeof message.model === 'string' && message.model.trim() ? message.model : opts.model,
      requestedModel: opts.model,
      usage: claudeUsage(message.usage),
      durationMs: Date.now() - startedAt,
    };
    const fail = (reason: string) => {
      const error = new Error(reason);
      // A paid response keeps its usage even when it cannot be used.
      Object.defineProperty(error, 'structuredTelemetry', { value: telemetry, enumerable: false });
      return error;
    };
    if (message.stop_reason === 'refusal') throw fail('CLAUDE_REFUSAL: the model declined this request.');
    if (message.stop_reason === 'max_tokens') throw fail('CLAUDE_MAX_TOKENS: the answer did not fit in max_tokens.');
    const text = message.content.filter(block => block.type === 'text').map(block => block.text || '').join('').trim();
    try {
      return { data: opts.schema.parse(JSON.parse(text)), telemetry };
    } catch (error) {
      throw Object.defineProperty(error instanceof Error ? error : new Error(String(error)), 'structuredTelemetry', { value: telemetry, enumerable: false });
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
