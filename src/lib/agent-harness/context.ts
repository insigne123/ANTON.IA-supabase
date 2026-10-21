// Keeping a long run inside the model's context without losing what it needs. Two steps, cheapest first, as Claude Code does:
// 1) clear the results of old tool calls (the model already used them and the call that made them stays in the conversation, so it can
//    ask again), and 2) summarize the oldest turns into a note and keep the recent ones whole. Pure: the summary is written by a
//    function the caller gives (a small, fast model), so this module has no SDK and tests use a plain function.
import type { ContentBlock, Message, ToolResultBlock, ToolUseBlock } from './types';

const CHARS_PER_TOKEN = 3.2;
const IMAGE_TOKENS = 1_600;
const DOCUMENT_TOKENS = 6_000;

function blockSize(block: ContentBlock): number {
  switch (block.type) {
    case 'text': return block.text.length / CHARS_PER_TOKEN;
    case 'thinking': return block.thinking.length / CHARS_PER_TOKEN;
    case 'redacted_thinking': return block.data.length / 4;
    case 'image': return IMAGE_TOKENS;
    case 'document': return DOCUMENT_TOKENS;
    case 'tool_use': return (block.name.length + JSON.stringify(block.input ?? null).length) / CHARS_PER_TOKEN + 8;
    case 'tool_result': return typeof block.content === 'string' ? block.content.length / CHARS_PER_TOKEN + 8
      : block.content.reduce((sum, part) => sum + blockSize(part), 8);
    default: return 0;
  }
}

/** A cheap estimate of the tokens a conversation takes (the API counts exactly; this only decides when to make room). */
export function estimateTokens(messages: Message[], system = ''): number {
  const body = messages.reduce((sum, message) => sum + (typeof message.content === 'string'
    ? message.content.length / CHARS_PER_TOKEN : message.content.reduce((inner, block) => inner + blockSize(block), 0)), 0);
  return Math.ceil(body + system.length / CHARS_PER_TOKEN);
}

const isToolResultMessage = (message: Message) => message.role === 'user' && Array.isArray(message.content)
  && message.content.some(block => block.type === 'tool_result');

/** The name of the tool behind each tool_use id, to say what a cleared result was. */
function toolNames(messages: Message[]): Map<string, { name: string; input: unknown }> {
  const names = new Map<string, { name: string; input: unknown }>();
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    for (const block of message.content) if (block.type === 'tool_use') names.set(block.id, { name: block.name, input: block.input });
  }
  return names;
}

const brief = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
};

/**
 * Replaces the content of old tool results with a line that says what was there. The most recent `keep` results stay whole.
 * The tool_use ↔ tool_result pairs stay, so the conversation is still valid for the API.
 */
export function clearOldToolResults(messages: Message[], keep = 6): { messages: Message[]; cleared: number } {
  const carriers = messages.map((message, index) => (isToolResultMessage(message) ? index : -1)).filter(index => index >= 0);
  const stale = new Set(carriers.slice(0, Math.max(0, carriers.length - keep)));
  if (!stale.size) return { messages, cleared: 0 };
  const names = toolNames(messages);
  let cleared = 0;
  const next = messages.map((message, index) => {
    if (!stale.has(index) || typeof message.content === 'string') return message;
    return { ...message, content: message.content.map((block): ContentBlock => {
      if (block.type !== 'tool_result') return block;
      const already = typeof block.content === 'string' && block.content.startsWith('[Resultado omitido');
      const size = typeof block.content === 'string' ? block.content.length : 1_000;
      if (already || size < 400) return block;
      const origin = names.get(block.tool_use_id);
      cleared += 1;
      const stub: ToolResultBlock = { type: 'tool_result', tool_use_id: block.tool_use_id, is_error: block.is_error,
        content: `[Resultado omitido para ahorrar espacio${origin ? `: ${origin.name}(${brief(origin.input)})` : ''}. Vuelve a consultarlo si lo necesitas.]` };
      return stub;
    }) };
  });
  return { messages: next, cleared };
}

/** The index where a tail of `keepLast` messages can start: an assistant turn, so the tail never begins in the middle of a tool exchange. */
export function tailStart(messages: Message[], keepLast: number): number {
  let index = Math.max(1, messages.length - keepLast);
  while (index < messages.length && messages[index].role !== 'assistant') index += 1;
  return index;
}

/** A readable copy of the turns that will be summarized: what was asked, what was done and what came back, cut short. */
export function transcriptOf(messages: Message[], perBlock = 1_200): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (typeof message.content === 'string') { lines.push(`${message.role === 'user' ? 'Usuario' : 'Agente'}: ${message.content.slice(0, perBlock)}`); continue; }
    for (const block of message.content) {
      if (block.type === 'text') lines.push(`${message.role === 'user' ? 'Usuario' : 'Agente'}: ${block.text.slice(0, perBlock)}`);
      else if (block.type === 'tool_use') lines.push(`Agente llamó ${block.name}(${brief(block.input)})`);
      else if (block.type === 'tool_result') lines.push(`Resultado${block.is_error ? ' (error)' : ''}: ${(typeof block.content === 'string' ? block.content : '[contenido]').slice(0, perBlock)}`);
    }
  }
  return lines.join('\n');
}

export const SUMMARY_PREFIX = 'Resumen de lo hecho hasta aquí (los turnos anteriores se resumieron para dejar espacio):';

/**
 * Summarizes everything between the first message and the tail into one note inside the first user message, keeping the tail whole.
 * `summarize` receives the transcript and returns the note; if it fails the conversation is returned unchanged (the run goes on and
 * the next call may still fit, or fails with the API's own error).
 */
export async function summarizeOldTurns(messages: Message[], keepLast: number,
  summarize: (transcript: string) => Promise<string>): Promise<{ messages: Message[]; summarized: number } | null> {
  const start = tailStart(messages, keepLast);
  if (start <= 1 || start >= messages.length) return null;
  const middle = messages.slice(1, start);
  const note = (await summarize(transcriptOf(middle))).trim();
  if (!note) return null;
  const first = messages[0];
  const firstBlocks: ContentBlock[] = typeof first.content === 'string' ? [{ type: 'text', text: first.content }] : first.content.filter(block => block.type !== 'tool_result');
  const merged: Message = { role: 'user', content: [...firstBlocks.filter(block => !(block.type === 'text' && block.text.startsWith(SUMMARY_PREFIX))), { type: 'text', text: `${SUMMARY_PREFIX}\n${note}` }] };
  return { messages: [merged, ...messages.slice(start)], summarized: middle.length };
}

/** Pairs of tool_use / tool_result that lost their partner (after a cut) make the API refuse the request: this finds them. */
export function danglingToolCalls(messages: Message[]): string[] {
  const used = new Set<string>();
  const answered = new Set<string>();
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const block of message.content) {
      if (block.type === 'tool_use') used.add((block as ToolUseBlock).id);
      if (block.type === 'tool_result') answered.add((block as ToolResultBlock).tool_use_id);
    }
  }
  return [...used].filter(id => !answered.has(id)).concat([...answered].filter(id => !used.has(id)));
}
