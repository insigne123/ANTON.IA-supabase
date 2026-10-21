// The shapes the agent harness shares: messages and content blocks as the model reads them, the model client every runtime
// plugs into, tools, and the events a run reports. Pure types: no SDK, no server module, so the loop, the tools and the tests
// run anywhere and the Anthropic client is only one implementation of ModelClient.
import type { z } from 'zod';

export type TextBlock = { type: 'text'; text: string };
export type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
export type DocumentBlock = { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
/** Reasoning the model did: it travels back to the API exactly as it came (signature included) while a turn uses tools. */
export type ThinkingBlock = { type: 'thinking'; thinking: string; signature: string } | { type: 'redacted_thinking'; data: string };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string | Array<TextBlock | ImageBlock>; is_error?: boolean };
export type ContentBlock = TextBlock | ImageBlock | DocumentBlock | ToolUseBlock | ThinkingBlock | ToolResultBlock;
export type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'pause_turn' | 'context_exceeded';

/** What a call cost, in the shape coworkModelUsage and the other ledgers already read. */
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** A tool as the model sees it. */
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type ModelRequest = {
  /** Stable rules of the run: cached between calls. */
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  /** Forces one tool (the final answer on the last round) or none. */
  toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string } | { type: 'none' };
  effort?: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Live text of the answer as it is written. */
  onText?: (delta: string, snapshot: string) => void;
  /** A tool call as its input is written: the JSON so far (a prefix of the input object). The final answer is a tool call, so this is how it shows live. */
  onToolInput?: (event: { name: string; json: string }) => void;
};

export type ModelResponse = {
  content: ContentBlock[];
  stopReason: StopReason;
  usage: Usage;
  /** The model that answered, which can differ from the one asked for. */
  model: string;
};

export interface ModelClient {
  /** The model's name, for the trace and the ledger. */
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

// ─── Tools ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `read` tools change nothing and run together when the model asks for several at once; `effect` tools change something or
 * spend something, run one at a time and pass the run's approval policy; `meta` tools are the harness's own (load a guide,
 * delegate, plan).
 */
export type ToolKind = 'read' | 'effect' | 'meta';

export type ToolContext = {
  signal: AbortSignal;
  /** Where the loop is: the round of the model call that asked for this tool, and how deep the sub-agents go. */
  round: number;
  depth: number;
  /** A place for tools of one run to share what they learn (what was read, what was proposed). */
  state: Map<string, unknown>;
  /** A line in the run's trace. */
  note: (message: string) => void;
};

/**
 * What a tool hands back. `ok` returns data to the model; `error` returns a problem the model can fix and try again (never
 * thrown: a bad id or a rejected proposal is a normal turn of the conversation); `final` ends the run with that value (the
 * answer, or a proposal the person has to approve).
 */
export type ToolOutcome =
  | { status: 'ok'; output: unknown; text?: string; images?: ImageBlock[] }
  | { status: 'error'; message: string }
  | { status: 'final'; output: unknown; text?: string };

export interface AgentTool<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I, z.ZodTypeDef, unknown>;
  kind: ToolKind;
  /** Words that find the tool when it is not loaded (see ToolRegistry): the domain, the nouns people use. */
  tags?: string[];
  /** Not offered at the start: the model finds it with `buscar_herramientas`. Keeps a large catalog out of every call. */
  deferred?: boolean;
  run(input: I, context: ToolContext): Promise<ToolOutcome>;
}

// ─── Events and results ────────────────────────────────────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'round'; round: number }
  | { type: 'text'; delta: string; snapshot: string }
  | { type: 'tool_input'; round: number; name: string; json: string }
  | { type: 'tool_start'; round: number; id: string; name: string; input: unknown }
  | { type: 'tool_end'; round: number; id: string; name: string; status: ToolOutcome['status']; ms: number; summary: string }
  | { type: 'compact'; before: number; after: number; method: 'clear' | 'summary' }
  | { type: 'review'; feedback: string | null }
  | { type: 'usage'; usage: Usage; model: string }
  | { type: 'note'; message: string };

export type AgentStopReason = 'final_tool' | 'end_turn' | 'max_rounds' | 'deadline' | 'aborted' | 'tool_budget';

export type AgentRun = {
  /** What the run ended with: the value of the `final` tool, or the model's closing text. */
  output: unknown;
  text: string;
  stopReason: AgentStopReason;
  rounds: number;
  toolCalls: number;
  usage: Usage;
  /** The conversation as it ended: for the next turn, for the trace, for tests. */
  messages: Message[];
  models: string[];
};
