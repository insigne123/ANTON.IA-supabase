// The Anthropic Messages API as a ModelClient for the agent loop: tool use, the system prompt and the conversation prefix cached
// between rounds, thinking left to the model, effort as the product sets it, live text, and the retries a long run needs (a 429 or
// an overloaded server in round six must not lose the five before it). The request builder is a pure function so tests read exactly
// what would be sent; the SDK sits behind a two-method interface a test replaces.
import Anthropic from '@anthropic-ai/sdk';
import { providerError } from '@/ai/anthropic-json';
import type { ContentBlock, Effort, Message, ModelClient, ModelRequest, ModelResponse, StopReason, ToolResultBlock, Usage } from './types';

/** Thinking spends output tokens before the answer: each effort gets room for it on top of the answer's own limit. */
const THINKING_ROOM: Record<Effort, number> = { low: 4_000, medium: 8_000, high: 16_000, xhigh: 24_000, max: 32_000 };

type RequestBlock = Record<string, unknown>;
type RequestMessage = { role: 'user' | 'assistant'; content: string | RequestBlock[] };

function requestBlock(block: ContentBlock): RequestBlock {
  if (block.type === 'tool_result') {
    const result: ToolResultBlock = block;
    return { type: 'tool_result', tool_use_id: result.tool_use_id, content: result.content, ...(result.is_error ? { is_error: true } : {}) };
  }
  return { ...block };
}

/** The messages as the API takes them. The last block of the last message carries the cache breakpoint: each round reads the whole
 * conversation so far from cache at a tenth of the price and only pays for what is new. */
export function requestMessages(messages: Message[]): RequestMessage[] {
  const converted: RequestMessage[] = messages.map(message => ({
    role: message.role, content: typeof message.content === 'string' ? message.content : message.content.map(requestBlock),
  }));
  const last = converted[converted.length - 1];
  if (last) {
    if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
    else if (last.content.length) last.content[last.content.length - 1] = { ...last.content[last.content.length - 1], cache_control: { type: 'ephemeral' } };
  }
  return converted;
}

export function anthropicRequest(request: ModelRequest, model: string) {
  const effort = request.effort ?? 'low';
  const forced = request.toolChoice?.type === 'tool' || request.toolChoice?.type === 'any';
  return {
    model,
    max_tokens: (request.maxTokens ?? 6_000) + THINKING_ROOM[effort],
    system: [{ type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' as const } }],
    messages: requestMessages(request.messages),
    ...(request.tools.length ? { tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) } : {}),
    ...(request.tools.length && request.toolChoice ? { tool_choice: request.toolChoice } : {}),
    // A forced tool call cannot be preceded by thinking.
    ...(forced ? { thinking: { type: 'disabled' as const } } : {}),
    output_config: { effort },
  };
}

type ApiMessage = {
  model?: string; stop_reason?: string | null; content: Array<Record<string, unknown> & { type: string }>;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | null;
};
type ApiStream = { on: (event: 'text' | 'streamEvent', listener: (...args: any[]) => void) => unknown; finalMessage: () => Promise<ApiMessage> };
export type AnthropicLike = { messages: { stream: (params: ReturnType<typeof anthropicRequest>, options: { signal?: AbortSignal }) => ApiStream } };

const STOP: Record<string, StopReason> = {
  end_turn: 'end_turn', tool_use: 'tool_use', max_tokens: 'max_tokens', refusal: 'refusal', stop_sequence: 'stop_sequence',
  pause_turn: 'pause_turn', model_context_window_exceeded: 'context_exceeded',
};

export function anthropicUsage(usage: ApiMessage['usage']): Usage {
  const read = usage?.cache_read_input_tokens ?? 0;
  const written = usage?.cache_creation_input_tokens ?? 0;
  return { inputTokens: (usage?.input_tokens ?? 0) + read + written, outputTokens: usage?.output_tokens ?? 0, cacheReadTokens: read, cacheWriteTokens: written };
}

const KNOWN = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use']);

export function responseOf(message: ApiMessage, requested: string): ModelResponse {
  const content = message.content.filter(block => KNOWN.has(block.type)).map((block): ContentBlock => {
    if (block.type === 'text') return { type: 'text', text: String(block.text ?? '') };
    if (block.type === 'thinking') return { type: 'thinking', thinking: String(block.thinking ?? ''), signature: String(block.signature ?? '') };
    if (block.type === 'redacted_thinking') return { type: 'redacted_thinking', data: String(block.data ?? '') };
    return { type: 'tool_use', id: String(block.id), name: String(block.name), input: block.input ?? {} };
  });
  return { content, stopReason: STOP[String(message.stop_reason)] ?? 'end_turn', usage: anthropicUsage(message.usage), model: message.model?.trim() || requested };
}

/** Statuses worth another try: the server was busy, not wrong. A dropped connection is too. */
const RETRYABLE = /CLAUDE_HTTP_(?:429|500|502|503|504|529)\b/;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const DROPPED = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|Connection error/i;
function retryable(error: unknown, failure: Error) {
  const status = (error as { status?: number } | null)?.status;
  return RETRYABLE.test(failure.message) || (typeof status === 'number' && RETRYABLE_STATUS.has(status)) || DROPPED.test(failure.message);
}

let defaultClient: AnthropicLike | null = null;
function sdkClient(): AnthropicLike {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('Missing AI provider credentials. Set ANTHROPIC_API_KEY to use Claude.');
  defaultClient ??= new Anthropic({ apiKey, maxRetries: 0 }) as unknown as AnthropicLike;
  return defaultClient;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

export type AnthropicModelOptions = { model: string; client?: AnthropicLike; retries?: number; backoffMs?: number };

export function anthropicModel(options: AnthropicModelOptions): ModelClient {
  const retries = options.retries ?? 2;
  return {
    name: options.model,
    async complete(request) {
      const client = options.client ?? sdkClient();
      for (let attempt = 0; ; attempt++) {
        try {
          const stream = client.messages.stream(anthropicRequest(request, options.model), { signal: request.signal });
          if (request.onText) {
            const onText = request.onText;
            stream.on('text', (delta, snapshot) => { try { onText(delta, snapshot); } catch { /* a live preview never breaks the call */ } });
          }
          if (request.onToolInput) {
            const onToolInput = request.onToolInput;
            // The input of a tool call arrives as JSON fragments by content block: each block's fragments are joined and handed over with its tool's name.
            const open = new Map<number, { name: string; json: string }>();
            stream.on('streamEvent', (event: { type?: string; index?: number; content_block?: { type?: string; name?: string }; delta?: { type?: string; partial_json?: string } } | null) => {
              try {
                if (!event || typeof event.index !== 'number') return;
                if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') open.set(event.index, { name: String(event.content_block.name), json: '' });
                else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
                  const block = open.get(event.index);
                  if (block) { block.json += event.delta.partial_json ?? ''; onToolInput({ name: block.name, json: block.json }); }
                }
              } catch { /* a live preview never breaks the call */ }
            });
          }
          return responseOf(await stream.finalMessage(), options.model);
        } catch (error) {
          request.signal?.throwIfAborted();
          const failure = providerError(error);
          if (attempt >= retries || !retryable(error, failure)) throw failure;
          await sleep((options.backoffMs ?? 800) * 2 ** attempt, request.signal);
        }
      }
    },
  };
}
