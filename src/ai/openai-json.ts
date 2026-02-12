import { z } from 'genkit';
import { ai } from '@/ai/genkit';

type StructuredOptions<T extends z.ZodTypeAny> = {
  prompt: string;
  schema: T;
  temperature?: number;
  openAiModel?: string;
  googleFallbackModel?: string;
};

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_GOOGLE_MODEL = process.env.GOOGLE_FALLBACK_MODEL || 'googleai/gemini-2.0-flash';

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

async function tryOpenAI<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>,
  apiKey: string
): Promise<z.infer<T>> {
  const model = opts.openAiModel || DEFAULT_OPENAI_MODEL;
  const temperature = opts.temperature ?? 0.3;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
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
    throw new Error(`OPENAI_HTTP_${res.status}:${txt.slice(0, 400)}`);
  }

  const payload = await res.json();
  const content = normalizeContent(payload?.choices?.[0]?.message?.content);
  const parsed = parseJsonFromModelText(content);
  return opts.schema.parse(parsed);
}

async function runGeminiFallback<T extends z.ZodTypeAny>(opts: StructuredOptions<T>): Promise<z.infer<T>> {
  const model = opts.googleFallbackModel || DEFAULT_GOOGLE_MODEL;
  const temperature = opts.temperature ?? 0.3;

  const { output } = await ai.generate({
    prompt: opts.prompt,
    model,
    config: { temperature },
    output: {
      format: 'json',
      schema: opts.schema,
    },
  });

  if (!output) {
    throw new Error('empty model output');
  }

  return opts.schema.parse(output);
}

export async function generateStructured<T extends z.ZodTypeAny>(
  opts: StructuredOptions<T>
): Promise<z.infer<T>> {
  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();

  if (openaiKey) {
    try {
      return await withRetries(() => tryOpenAI(opts, openaiKey), 3);
    } catch (e: any) {
      console.warn('[AI] OpenAI failed, falling back to Gemini:', e?.message || e);
    }
  }

  return withRetries(() => runGeminiFallback(opts), 3);
}
