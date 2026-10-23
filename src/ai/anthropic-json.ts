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

/** A property that accepts any JSON value (z.unknown(), an empty schema) has no type Claude takes: it travels as JSON text and
 * claudeReadJsonText turns it back into its value before the full schema validates the answer. */
const JSON_TEXT = { type: 'string', description: 'El valor en JSON, escrito como texto.' };
const isAnyValue = (value: unknown) => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0;

/** The API does not take a length or an item count, so it travels as words in the description, where the model still reads it. */
function sizeHint(node: Record<string, unknown>) {
  return [
    typeof node.maxLength === 'number' ? `Máximo ${node.maxLength} caracteres.` : '',
    typeof node.maxItems === 'number' ? `Máximo ${node.maxItems} elementos.` : '',
  ].filter(Boolean).join(' ');
}

/** The schema's JSON for structured outputs: every object closed and without the constraints the API does not
 * take (lengths, ranges, item counts); the limits on size stay in the descriptions. The answer is still validated with the
 * full schema afterwards. `jsonText` names the properties sent as JSON text. */
export function claudeSchemaPlan(schema: z.ZodTypeAny): { json: Record<string, unknown>; jsonText: Set<string> } {
  const jsonText = new Set<string>();
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => !UNSUPPORTED_KEYWORDS.has(key) && !(key === 'format' && !SUPPORTED_FORMATS.has(String(item))))
      .map(([key, item]) => [key, key === 'properties'
        ? Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([name, property]) => {
          if (!isAnyValue(property)) return [name, clean(property)];
          jsonText.add(name);
          return [name, JSON_TEXT];
        }))
        : clean(item)]);
    const node = Object.fromEntries(entries) as Record<string, unknown>;
    const hint = sizeHint(value as Record<string, unknown>);
    if (hint) node.description = [typeof node.description === 'string' ? node.description : '', hint].filter(Boolean).join(' ');
    if (node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object')) || node.properties) node.additionalProperties = false;
    return node;
  };
  const json = clean(zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' })) as Record<string, unknown>;
  return { json, jsonText };
}

/** What Claude compiles into a format: at most 24 optional parameters and 16 nullable or union-typed ones. */
const FORMAT_LIMITS = { optional: 24, unions: 16 };

/** Whether the schema fits in Claude's structured outputs. A larger one (the coordinator's decision, with over a hundred
 * nullable fields) travels in the instructions instead: claudeRequest writes it there and the answer is validated the same way. */
export function claudeFormatFits(json: Record<string, unknown>) {
  let optional = 0;
  let unions = 0;
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.properties && typeof node.properties === 'object') {
      const required = new Set(Array.isArray(node.required) ? node.required as string[] : []);
      optional += Object.keys(node.properties as object).filter(name => !required.has(name)).length;
    }
    if (Array.isArray(node.type) || Array.isArray(node.anyOf)) unions += 1;
    Object.values(node).forEach(walk);
  };
  walk(json);
  return optional <= FORMAT_LIMITS.optional && unions <= FORMAT_LIMITS.unions;
}

/** The instruction that carries a schema too large for the format. */
export function claudeSchemaInstruction(json: Record<string, unknown>) {
  const properties = (json.properties && typeof json.properties === 'object' ? json.properties : {}) as Record<string, { type?: unknown; anyOf?: Array<{ type?: unknown }> }>;
  const required = Array.isArray(json.required) ? json.required as string[] : [];
  const nullable = (name: string) => { const property = properties[name] || {};
    return property.type === 'null' || (Array.isArray(property.type) && property.type.includes('null')) || Boolean(property.anyOf?.some(option => option.type === 'null')); };
  const valued = required.filter(name => !nullable(name));
  const present = required.filter(nullable);
  return [
    'Responde solo con un objeto JSON válido, sin texto ni bloques de código alrededor, que cumpla este JSON Schema. Un campo opcional puede omitirse o ir en null cuando el esquema lo permite.',
    valued.length ? `Siempre llevan un valor del esquema, nunca null: ${valued.join(', ')}.` : '',
    present.length ? `Siempre van, aunque sea en null: ${present.join(', ')}.` : '',
    JSON.stringify(json),
  ].filter(Boolean).join('\n');
}

/** The JSON object of an answer written without the format: without a code fence or words around it. */
export function claudeJsonText(text: string) {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

/** Without the format nothing stops an extra top-level key the schema does not have; it is dropped instead of costing a retry. */
export function claudeKnownKeys(value: unknown, json: Record<string, unknown>) {
  const properties = json.properties && typeof json.properties === 'object' ? json.properties as Record<string, unknown> : null;
  if (!properties || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key in properties));
}

/** The longest limit a text is cut back to without asking the model again: a title, a reason; never a body someone reads whole. */
const CUT_UP_TO = 600;

/** A text cut at the last space that fits, closed with «…» so it reads as cut. */
export function claudeCut(text: string, max: number) {
  if (text.length <= max) return text;
  if (max < 2) return text.slice(0, Math.max(0, max));
  const room = max - 1;
  const head = text.slice(0, room).replace(/[\uD800-\uDBFF]$/, '');
  const space = head.lastIndexOf(' ');
  return `${(space > room * 0.6 ? head.slice(0, space) : head).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

type TooBigIssue = { code?: string; type?: string; maximum?: number | bigint; inclusive?: boolean; exact?: boolean; path?: Array<string | number> };
type Container = Record<string | number, unknown>;

/** The answer with the short texts and the lists that went over a limit the format cannot state cut back to it (the format only holds
 * what the schema checks afterwards). Null when anything else is wrong, or when the text is one a person reads whole: that goes back
 * to the model. `cut` names where. */
export function claudeClamp(value: unknown, error: unknown): { value: unknown; cut: string[] } | null {
  const issues = (error as { issues?: TooBigIssue[] } | null)?.issues;
  if (!Array.isArray(issues) || !issues.length || !value || typeof value !== 'object') return null;
  const clone = structuredClone(value) as Container;
  const cut: string[] = [];
  for (const issue of issues) {
    const path = issue.path || [];
    if (issue.code !== 'too_big' || issue.exact || !path.length || typeof issue.maximum !== 'number') return null;
    let parent: unknown = clone;
    for (const key of path.slice(0, -1)) parent = parent && typeof parent === 'object' ? (parent as Container)[key] : undefined;
    if (!parent || typeof parent !== 'object') return null;
    const holder = parent as Container;
    const key = path[path.length - 1];
    const max = issue.maximum - (issue.inclusive === false ? 1 : 0);
    if (issue.type === 'string' && typeof holder[key] === 'string' && max <= CUT_UP_TO) holder[key] = claudeCut(holder[key] as string, max);
    else if (issue.type === 'array' && Array.isArray(holder[key])) holder[key] = (holder[key] as unknown[]).slice(0, max);
    else return null;
    cut.push(path.join('.'));
  }
  return { value: clone, cut };
}

export function claudeJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return claudeSchemaPlan(schema).json;
}

/** The answer with each property sent as JSON text (claudeSchemaPlan) read back into its value; text that is not JSON stays as written. */
export function claudeReadJsonText(value: unknown, jsonText: Set<string>): unknown {
  if (!jsonText.size) return value;
  if (Array.isArray(value)) return value.map(item => claudeReadJsonText(item, jsonText));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (jsonText.has(key) && typeof item === 'string') {
      try { return [key, JSON.parse(item)]; } catch { return [key, item]; }
    }
    return [key, claudeReadJsonText(item, jsonText)];
  }));
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

/** An image or a PDF the model reads with the prompt (vision): its bytes in base64. */
export type ClaudeAttachment = { kind: 'image' | 'pdf'; mediaType: string; data: string };

export type ClaudeStructuredOptions<T extends z.ZodTypeAny> = {
  model: string;
  prompt: string;
  /** Images and PDFs read before the prompt; the last one is cached, so a corrected answer does not pay for it twice. */
  attachments?: ClaudeAttachment[];
  systemPrompt?: string;
  schema: T;
  maxOutputTokens?: number;
  reasoningEffort?: StructuredEffort | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  onPartial?: (content: string) => void;
};

/** The user turn: the prompt alone, or the images and PDFs first and then the prompt that says what to do with them. */
export function claudeContent(prompt: string, attachments?: ClaudeAttachment[]) {
  if (!attachments?.length) return prompt;
  const last = attachments.length - 1;
  return [
    ...attachments.map((file, index) => {
      const cache = index === last ? { cache_control: { type: 'ephemeral' as const } } : {};
      return file.kind === 'pdf'
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file.data }, ...cache }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: file.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: file.data }, ...cache };
    }),
    { type: 'text' as const, text: prompt },
  ];
}

/** A correction of an answer that did not fit the schema: what it wrote and what was wrong. */
export type ClaudeRepair = { previous: string; problem: string };

/** The request: the JSON format, the effort and room for thinking. Thinking stays as the model has it by default
 * (adaptive on the current models); no sampling parameters, which they reject. The system prompt (a role's fixed rules) is
 * cached: the correction and the next turns read it at a tenth of the price. */
export function claudeRequest<T extends z.ZodTypeAny>(opts: ClaudeStructuredOptions<T>, repair?: ClaudeRepair) {
  const effort = claudeEffort(opts.reasoningEffort);
  const schema = claudeJsonSchema(opts.schema);
  const fits = claudeFormatFits(schema);
  // A schema too large for the format goes after the role's rules, in the same cached system prompt.
  const system = [opts.systemPrompt, fits ? '' : claudeSchemaInstruction(schema)].filter(Boolean).join('\n\n');
  const correction = repair ? [{ role: 'assistant' as const, content: repair.previous || '{}' },
    { role: 'user' as const, content: `Tu respuesta no cumple el JSON Schema:\n${repair.problem}\nResponde de nuevo solo con el objeto JSON completo y corregido.` }] : [];
  return {
    model: opts.model,
    max_tokens: (opts.maxOutputTokens ?? 6000) + THINKING_ROOM[effort],
    ...(system ? { system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }] } : {}),
    messages: [{ role: 'user' as const, content: claudeContent(opts.prompt, opts.attachments) }, ...correction],
    output_config: fits ? { effort, format: { type: 'json_schema' as const, schema } } : { effort },
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
export function providerError(error: unknown): Error {
  if (error instanceof Anthropic.APIError) {
    const detail = String(error.message || '').slice(0, 400);
    const credits = /credit balance is too low/i.test(detail) ? ' credit_balance_exhausted' : '';
    return new Error(`CLAUDE_HTTP_${error.status ?? 'error'}:${detail}${credits}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Two calls' usage as one: a repaired answer is paid twice. */
function addUsage(a: ReturnType<typeof claudeUsage>, b: ReturnType<typeof claudeUsage>) {
  return { ...a, prompt_tokens: a.prompt_tokens + b.prompt_tokens, completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens, prompt_tokens_details: { cached_tokens: a.prompt_tokens_details.cached_tokens + b.prompt_tokens_details.cached_tokens },
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens };
}

/** What was wrong with an answer written without the format, in a few lines the model can fix. */
export function claudeProblem(error: unknown) {
  const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> } | null)?.issues;
  if (Array.isArray(issues) && issues.length) return issues.slice(0, 5).map(issue => `${(issue.path || []).join('.') || '(raíz)'}: ${issue.message || 'no cumple'}`).join('\n');
  return error instanceof SyntaxError ? 'No es un objeto JSON válido.' : String((error as Error)?.message || error).slice(0, 300);
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
  const plan = claudeSchemaPlan(opts.schema);
  const fits = claudeFormatFits(plan.json);
  let usage: ReturnType<typeof claudeUsage> | null = null;
  let modelName = opts.model;
  const telemetry = () => ({ modelName, requestedModel: opts.model, usage: usage ?? claudeUsage(null), durationMs: Date.now() - startedAt });
  const withTelemetry = (error: unknown) =>
    Object.defineProperty(error instanceof Error ? error : new Error(String(error)), 'structuredTelemetry', { value: telemetry(), enumerable: false });
  const ask = async (repair?: ClaudeRepair) => {
    let message: ClaudeMessage;
    try {
      const stream = client.messages.stream(claudeRequest(opts, repair), { signal });
      if (opts.onPartial && !repair) {
        const onPartial = opts.onPartial;
        // A live preview never breaks the answer.
        stream.on('text', (_delta, snapshot) => { try { onPartial(snapshot.replace(/^\s*```(?:json)?\s*/i, '')); } catch { /* ignored */ } });
      }
      message = await stream.finalMessage();
    } catch (error) {
      signal?.throwIfAborted();
      throw providerError(error);
    }
    // A paid response keeps its usage even when it cannot be used.
    usage = usage ? addUsage(usage, claudeUsage(message.usage)) : claudeUsage(message.usage);
    if (typeof message.model === 'string' && message.model.trim()) modelName = message.model;
    if (message.stop_reason === 'refusal') throw withTelemetry(new Error('CLAUDE_REFUSAL: the model declined this request.'));
    if (message.stop_reason === 'max_tokens') throw withTelemetry(new Error('CLAUDE_MAX_TOKENS: the answer did not fit in max_tokens.'));
    return message.content.filter(block => block.type === 'text').map(block => block.text || '').join('').trim();
  };
  const read = (text: string) => {
    const value = fits ? claudeReadJsonText(JSON.parse(text), plan.jsonText) : claudeKnownKeys(JSON.parse(claudeJsonText(text)), plan.json);
    try {
      return opts.schema.parse(value);
    } catch (error) {
      // A short text or a list a little over a limit the format cannot state is cut back to it, not asked for again.
      const clamped = claudeClamp(value, error);
      if (!clamped) throw error;
      return opts.schema.parse(clamped.value);
    }
  };
  try {
    signal?.throwIfAborted();
    const text = await ask();
    try {
      return { data: read(text), telemetry: telemetry() };
    } catch (error) {
      // Neither the format nor the large schema's instruction holds every limit the schema checks (lengths, ranges, item counts, rules):
      // one correction, told what was wrong, before giving up.
      if (signal?.aborted) throw withTelemetry(error);
      const repaired = await ask({ previous: text, problem: claudeProblem(error) });
      try { return { data: read(repaired), telemetry: telemetry() }; } catch (again) { throw withTelemetry(again); }
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
