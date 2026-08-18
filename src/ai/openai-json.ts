import { z } from 'genkit';

type StructuredOptions<T extends z.ZodTypeAny> = {
  prompt: string;
  schema: T;
  temperature?: number;
  openAiModel?: string;
  openAiModels?: string[];
};

type StructuredProvider = 'openai' | 'glm';

type StructuredProviderConfig = {
  provider: StructuredProvider;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
};

export type StructuredTelemetry = {
  modelName: string;
  usage?: Record<string, unknown> | null;
  durationMs: number;
};

export type StructuredResult<T extends z.ZodTypeAny> = {
  data: z.infer<T>;
  telemetry: StructuredTelemetry;
};

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_GLM_MODEL = process.env.GLM_MODEL || 'glm-5.2';
const DEFAULT_GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

function env(name: string) {
  return String(process.env[name] || '').trim();
}

function getStructuredProvider(): StructuredProvider {
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

function getStructuredProviderConfig(): StructuredProviderConfig {
  const provider = getStructuredProvider();

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const finalTry = i === attempts - 1;
      if (finalTry || !isRetryableError(e)) {
        throw e;
      }
      await sleep(Math.min(700 * 2 ** i, 4000));
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

async function tryChatCompletions<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>,
  config: StructuredProviderConfig
): Promise<StructuredResult<T>> {
  const model = opts.openAiModel || config.defaultModel;
  const temperature = opts.temperature ?? 0.3;
  const startedAt = Date.now();

  const res = await fetch(chatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON generator. Return valid JSON only.',
        },
        {
          role: 'user',
          content: opts.prompt,
        },
      ],
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${config.displayName.toUpperCase()}_HTTP_${res.status}:${txt.slice(0, 400)}`);
  }

  const payload = await res.json();
  const content = normalizeContent(payload?.choices?.[0]?.message?.content);
  const parsed = parseJsonFromModelText(content);
  return {
    data: opts.schema.parse(parsed),
    telemetry: {
      modelName: model,
      usage: payload?.usage || null,
      durationMs: Date.now() - startedAt,
    },
  };
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
  const config = getStructuredProviderConfig();

  if (!config.apiKey) {
    const keyName = config.provider === 'glm' ? 'GLM_API_KEY' : 'OPENAI_API_KEY';
    throw new Error(`Missing AI provider credentials. Set ${keyName} to use ${config.displayName}.`);
  }

  const models = Array.from(new Set([
    ...(opts.openAiModels || []),
    opts.openAiModel,
    config.defaultModel,
  ].map((model) => String(model || '').trim()).filter(Boolean)));

  let lastError: any;
  for (const model of models) {
    try {
      return await withRetries(() => tryChatCompletions({ ...opts, openAiModel: model }, config), 3);
    } catch (error) {
      lastError = error;
      console.warn(`[${config.displayName}] Structured generation failed with ${model}:`, error);
    }
  }

  throw lastError;
}
