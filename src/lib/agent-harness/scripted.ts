// A model that follows a script, for tests and for replaying a recorded run: each call to `complete` returns the next response (or
// whatever a function decides from the request), and every request is kept so a test can read what the model was shown.
import type { ContentBlock, ModelClient, ModelRequest, ModelResponse, StopReason, Usage } from './types';

export const usageOf = (inputTokens = 100, outputTokens = 50): Usage => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function reply(content: ContentBlock[] | string, stopReason?: StopReason, usage: Usage = usageOf()): ModelResponse {
  const blocks: ContentBlock[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  const stop = stopReason ?? (blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn');
  return { content: blocks, stopReason: stop, usage, model: 'scripted' };
}

let counter = 0;
/** One tool call; several of them in one response are the model asking for them at once. */
export const call = (name: string, input: unknown, id?: string): ContentBlock => ({ type: 'tool_use', id: id ?? `toolu_${++counter}`, name, input });

export type ScriptStep = ModelResponse | ((request: ModelRequest, index: number) => ModelResponse | Promise<ModelResponse>);

export class ScriptedModel implements ModelClient {
  readonly name: string;
  readonly requests: ModelRequest[] = [];
  private index = 0;
  constructor(private steps: ScriptStep[], name = 'scripted') { this.name = name; }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    // Requests keep a copy of the conversation as it was: the loop goes on appending to its own array.
    this.requests.push({ ...request, messages: JSON.parse(JSON.stringify(request.messages)) });
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    if (this.index >= this.steps.length) throw new Error(`ScriptedModel: no more steps (call ${this.index + 1})`);
    this.index += 1;
    return typeof step === 'function' ? step(request, this.index - 1) : step;
  }

  get calls() { return this.index; }
}
