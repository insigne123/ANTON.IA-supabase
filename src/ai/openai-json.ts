import timers from 'node:timers/promises';
import { z } from 'genkit';
import { zodToJsonSchema } from 'zod-to-json-schema';

type StructuredOptions<T extends z.ZodTypeAny> = {
  prompt: string;
  systemPrompt?: string;
  schema: T;
  temperature?: number;
  openAiModel?: string;
  openAiModels?: string[];
  allowDefaultModelFallback?: boolean;
  timeoutMs?: number;
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxAttempts?: number;
  provider?: StructuredProvider;
  signal?: AbortSignal;
  /**
   * OpenAI only: the response streams and this receives the JSON text written
   * so far, for a live preview. The result is the same validated JSON as without it.
   */
  onPartial?: (content: string) => void;
};

export type StructuredProvider = 'openai' | 'glm';

type StructuredProviderConfig = {
  provider: StructuredProvider;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
};

export type StructuredTelemetry = {
  modelName: string;
  requestedModel?: string;
  usage?: Record<string, unknown> | null;
  durationMs: number;
};

export type StructuredResult<T extends z.ZodTypeAny> = {
  data: z.infer<T>;
  telemetry: StructuredTelemetry;
};

const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_GLM_MODEL = process.env.GLM_MODEL || 'glm-5.2';
const DEFAULT_GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_SYSTEM_PROMPT = 'You are a strict JSON generator. Return valid JSON only.';

/**
 * Models ANTON.IA never calls, whatever an environment variable or a caller asks for: the Astra family spends far more credits
 * than the rest (decision of the account owner, 6 Oct 2026). Checked here, where every structured call to OpenAI goes out.
 */
export function isBlockedOpenAiModel(model: string) {
  return /astra/i.test(model);
}

function env(name: string) {
  return String(process.env[name] || '').trim();
}

function getStructuredProvider(requestedProvider?: StructuredProvider): StructuredProvider {
  if (requestedProvider) return requestedProvider;
  const provider = (env('SUPLIA_AI_PROVIDER') || env('AI_PROVIDER')).toLowerCase();
  if (provider === 'glm' || provider === 'zhipu' || provider === 'bigmodel' || provider === 'zai' || provider === 'z.ai') {
    return 'glm';
  }
  return 'openai';
}

function normalizeBaseUrl(baseUrl: string) {
  return String(baseUrl || '').trim().replace(/\/+$/g, '');
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function isReasoningModel(model: string) {
  return /^gpt-[56](?:[.-]|$)/i.test(model);
}

function deterministicSchemaName(schema: object) {
  const serialized = JSON.stringify(schema);
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `structured_output_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function responseFormat<T extends z.ZodTypeAny>(schema: T, provider: StructuredProvider) {
  if (provider !== 'openai') return { type: 'json_object' };

  const jsonSchema = sanitizeOpenAiJsonSchema(zodToJsonSchema(schema, {
    target: 'openAi',
    $refStrategy: 'none',
  })) as Record<string, unknown>;
  return {
    type: 'json_schema',
    json_schema: {
      name: deterministicSchemaName(jsonSchema),
      strict: true,
      schema: jsonSchema,
    },
  };
}

function sanitizeOpenAiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeOpenAiJsonSchema);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => !(
      (key === 'exclusiveMaximum' || key === 'exclusiveMinimum')
      && typeof item === 'boolean'
    ) && !(key === 'format' && item === 'uri'))
    .map(([key, item]) => [key, sanitizeOpenAiJsonSchema(item)]));
}

function getStructuredProviderConfig(requestedProvider?: StructuredProvider): StructuredProviderConfig {
  const provider = getStructuredProvider(requestedProvider);

  if (provider === 'glm') {
    return {
      provider,
      displayName: 'GLM',
      apiKey: env('GLM_API_KEY') || env('ZHIPU_API_KEY') || env('BIGMODEL_API_KEY'),
      baseUrl: env('GLM_BASE_URL') || env('ZHIPU_BASE_URL') || env('BIGMODEL_BASE_URL') || DEFAULT_GLM_BASE_URL,
      defaultModel: env('SUPLIA_GLM_MODEL') || env('GLM_MODEL') || DEFAULT_GLM_MODEL,
    };
  }

  return {
    provider,
    displayName: 'OpenAI',
    apiKey: env('OPENAI_API_KEY'),
    baseUrl: env('OPENAI_BASE_URL') || DEFAULT_OPENAI_BASE_URL,
    defaultModel: env('OPENAI_MODEL') || DEFAULT_OPENAI_MODEL,
  };
}

function isCancellationError(error: any) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError';
}

function isRetryableError(error: any) {
  const text = String(error?.message || error || '').toLowerCase();
  return (
    text.includes('429') ||
    text.includes('resource exhausted') ||
    text.includes('rate limit') ||
    text.includes('temporarily unavailable')
  );
}

async function withRetries<T>(fn: () => Promise<T>, signal?: AbortSignal, attempts = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (e: any) {
      signal?.throwIfAborted();
      lastError = e;
      const finalTry = i === attempts - 1;
      if (finalTry || isCancellationError(e) || !isRetryableError(e)) {
        throw e;
      }
      await timers.setTimeout(Math.min(700 * 2 ** i, 4000), undefined, { signal });
    }
  }
  throw lastError;
}

function normalizeContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join(' ')
      .trim();
  }
  return String(content || '');
}

function parseJsonFromModelText(raw: string): unknown {
  const text = String(raw || '').trim();
  if (!text) throw new Error('empty model response');

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      return JSON.parse(slice);
    }
    throw new Error('model did not return valid JSON');
  }
}

/** Reads a chat completions event stream: the text written so far goes to onPartial, and the
 * whole text, the effective model and the usage (last chunk, with include_usage) come back. */
async function readChatStream(body: ReadableStream<Uint8Array>, onPartial: (content: string) => void, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let model: unknown = null;
  let usage: unknown = null;
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: any;
    try { chunk = JSON.parse(data); } catch { return; }
    if (chunk?.error) throw new Error(`OPENAI_STREAM_ERROR:${String(chunk.error?.message || '').slice(0, 400)}`);
    if (typeof chunk?.model === 'string') model = chunk.model;
    if (chunk?.usage) usage = chunk.usage;
    const piece = chunk?.choices?.[0]?.delta?.content;
    if (typeof piece === 'string' && piece) {
      content += piece;
      // A live preview never breaks the answer.
      try { onPartial(content); } catch { /* ignored */ }
    }
  };
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        handle(buffer.slice(0, newline).trim());
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer.trim());
  } finally {
    try { reader.releaseLock(); } catch { /* already released by an abort */ }
  }
  return { content, model, usage };
}

async function tryChatCompletions<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>,
  config: StructuredProviderConfig
): Promise<StructuredResult<T>> {
  const model = opts.openAiModel || config.defaultModel;
  if (isBlockedOpenAiModel(model)) throw new Error(`El modelo ${model} no está permitido en ANTON.IA.`);
  const temperature = opts.temperature ?? 0.3;
  const startedAt = Date.now();
  const streaming = Boolean(opts.onPartial) && config.provider === 'openai';
  const requestBody = {
    model,
    ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(isReasoningModel(model) ? {} : { temperature }),
    ...(config.provider === 'openai' && opts.maxOutputTokens !== undefined
      ? { max_completion_tokens: opts.maxOutputTokens } : {}),
    ...(config.provider === 'openai' && isReasoningModel(model)
      ? { reasoning_effort: opts.reasoningEffort ?? (model.toLowerCase().startsWith('gpt-6-') ? 'low' : undefined) } : {}),
    response_format: responseFormat(opts.schema, config.provider),
    messages: [
      {
        role: 'system',
        content: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: opts.prompt,
      },
    ],
  };

  const timeoutController = opts.timeoutMs === undefined ? undefined : new AbortController();
  const signal = timeoutController
    ? (opts.signal ? AbortSignal.any([opts.signal, timeoutController.signal]) : timeoutController.signal)
    : opts.signal;
  const timeout = timeoutController && setTimeout(
    () => timeoutController.abort(new DOMException('Structured generation timed out.', 'TimeoutError')),
    opts.timeoutMs,
  );

  try {
    signal?.throwIfAborted();
    const res = await fetch(chatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      cache: 'no-store',
      signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${config.displayName.toUpperCase()}_HTTP_${res.status}:${txt.slice(0, 400)}`);
    }

    let content: string;
    let responseModel: unknown;
    let usage: unknown;
    if (streaming && res.body && opts.onPartial) {
      ({ content, model: responseModel, usage } = await readChatStream(res.body, opts.onPartial, signal));
    } else {
      const payload = await res.json();
      content = normalizeContent(payload?.choices?.[0]?.message?.content);
      responseModel = payload?.model;
      usage = payload?.usage;
    }
    signal?.throwIfAborted();
    const parsed = parseJsonFromModelText(content);
    return {
      data: opts.schema.parse(parsed),
      telemetry: {
        modelName: typeof responseModel === 'string' && responseModel.trim() ? responseModel : model,
        requestedModel: model,
        usage: (usage as Record<string, unknown> | null) || null,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function generateStructured<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>
): Promise<z.infer<T>> {
  const result = await generateStructuredWithTelemetry(opts);
  return result.data;
}

export async function generateStructuredWithTelemetry<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>
): Promise<StructuredResult<T>> {
  opts.signal?.throwIfAborted();
  const config = getStructuredProviderConfig(opts.provider);

  if (!config.apiKey) {
    const keyName = config.provider === 'glm' ? 'GLM_API_KEY' : 'OPENAI_API_KEY';
    throw new Error(`Missing AI provider credentials. Set ${keyName} to use ${config.displayName}.`);
  }

  const models = Array.from(new Set([
    ...(opts.openAiModels || []),
    opts.openAiModel,
    ...(opts.allowDefaultModelFallback === false ? [] : [config.defaultModel]),
  ].map((model) => String(model || '').trim()).filter(Boolean)));
  const blocked = models.filter(isBlockedOpenAiModel);
  if (blocked.length) {
    // A blocked model is skipped before any request: the next allowed one answers, or the call fails without spending.
    console.warn(`[${config.displayName}] Skipping models not allowed in ANTON.IA: ${blocked.join(', ')}`);
    models.splice(0, models.length, ...models.filter((model) => !isBlockedOpenAiModel(model)));
    if (!models.length) throw new Error(`El modelo ${blocked.join(', ')} no está permitido en ANTON.IA.`);
  }

  if (!models.length) {
    throw new Error('Specify openAiModel or openAiModels when default model fallback is disabled.');
  }

  let lastError: any;
  for (const model of models) {
    try {
      return await withRetries(() => tryChatCompletions({ ...opts, openAiModel: model }, config), opts.signal, Math.max(1, Math.min(3, opts.maxAttempts ?? 3)));
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (isCancellationError(error)) throw error;
      lastError = error;
      console.warn(`[${config.displayName}] Structured generation failed with ${model}:`, error);
    }
  }

  throw lastError;
}
