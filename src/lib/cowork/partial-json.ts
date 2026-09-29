/**
 * Reading a JSON value while the model is still writing it. The coordinator
 * answers with strict JSON whose fields come in schema order: `action` first and
 * `answer.reply` near the end, so the text can be shown as it arrives. Nothing
 * here decides anything: the final, validated JSON still comes from the full
 * response.
 */
import { polishCoworkText } from './answer-quality';

/** memberStart: where the current member begins (its comma included), so a half member can be cut away. */
type Frame = { kind: 'object' | 'array'; expectKey: boolean; afterKey: boolean; memberStart: number };

const PARTIAL_LITERAL = /(?:^|[\s,:[{])(t|tr|tru|f|fa|fal|fals|n|nu|nul)$/;
const PARTIAL_NUMBER = /-?(?:\d+\.|\d+[eE][+-]?|-)$/;

/**
 * Closes a JSON prefix so it parses: finishes the open string (dropping a
 * half-written escape), drops a half-written key, a key without its value, a
 * trailing comma or a half-written literal, and closes the open objects and
 * arrays. Returns null when the prefix cannot be read yet.
 */
export function coworkRepairJson(prefix: string): string | null {
  const text = String(prefix || '');
  const stack: Frame[] = [];
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let stringIsKey = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') {
        inString = false;
        const top = stack[stack.length - 1];
        if (stringIsKey && top) { top.expectKey = false; top.afterKey = true; }
      }
      continue;
    }
    if (char === '"') {
      const top = stack[stack.length - 1];
      inString = true;
      stringStart = index;
      stringIsKey = top?.kind === 'object' && top.expectKey;
    } else if (char === ':') {
      const top = stack[stack.length - 1];
      if (top) top.afterKey = false;
    } else if (char === '{') {
      stack.push({ kind: 'object', expectKey: true, afterKey: false, memberStart: index + 1 });
    } else if (char === '[') {
      stack.push({ kind: 'array', expectKey: false, afterKey: false, memberStart: index + 1 });
    } else if (char === '}' || char === ']') {
      stack.pop();
    } else if (char === ',') {
      const top = stack[stack.length - 1];
      if (top) { top.memberStart = index; if (top.kind === 'object') top.expectKey = true; }
    }
  }
  if (!stack.length && !inString) return text.trim() ? text : null;

  let out = text;
  const open = stack[stack.length - 1];
  // A whole key still waiting for its colon: the member is not there yet.
  if (!inString && open?.afterKey) out = text.slice(0, open.memberStart);
  if (inString) {
    if (stringIsKey) {
      out = text.slice(0, stack[stack.length - 1].memberStart);
    } else {
      let body = text.slice(stringStart + 1);
      if (escaped) body = body.slice(0, -1);
      body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
      out = `${text.slice(0, stringStart + 1)}${body}"`;
    }
  }
  // Tokens that cannot stand at the end: a comma, a key waiting for its value, half a literal or number.
  for (let guard = 0; guard < 8; guard++) {
    const trimmed = out.trimEnd();
    const top = stack[stack.length - 1];
    if (trimmed.endsWith(',')) { out = trimmed.slice(0, -1); continue; }
    if (trimmed.endsWith(':') && top) { out = trimmed.slice(0, top.memberStart); continue; }
    const literal = PARTIAL_LITERAL.exec(trimmed);
    if (literal) { out = trimmed.slice(0, trimmed.length - literal[1].length); continue; }
    const number = PARTIAL_NUMBER.exec(trimmed);
    if (number && !inString) { out = trimmed.slice(0, trimmed.length - number[0].length); continue; }
    out = trimmed;
    break;
  }
  for (let level = stack.length - 1; level >= 0; level--) out += stack[level].kind === 'object' ? '}' : ']';
  return out;
}

/** The JSON prefix read as a value, or null while it cannot be read. */
export function coworkParsePartialJson(prefix: string): unknown {
  const repaired = coworkRepairJson(prefix);
  if (!repaired) return null;
  try { return JSON.parse(repaired); } catch { return null; }
}

/** What the page can show while an answer is being written: the text so far and how far each card got. */
export type CoworkLiveDraft = {
  reply: string;
  cards: Array<{ type: string; title: string | null; parts: number }>;
};

const CARD_PARTS: Record<string, string> = { email_draft: 'body', sequence: 'steps', table: 'rows', metrics: 'items' };

/**
 * The live draft of a coordinator decision, only once it is known to be an
 * answer: a read or a proposal shows nothing. `parts` counts what a card has
 * so far (emails of a sequence, rows of a table, figures), for «correo 2 de 3».
 * The text gets the same polish as the final answer, so an internal code or an
 * ID in parentheses never shows while it is written.
 */
export function coworkLiveDraft(prefix: string): CoworkLiveDraft | null {
  const value = coworkParsePartialJson(prefix);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const decision = value as { action?: unknown; answer?: unknown };
  if (decision.action !== 'answer' || !decision.answer || typeof decision.answer !== 'object') return null;
  const answer = decision.answer as { reply?: unknown; blocks?: unknown };
  const reply = typeof answer.reply === 'string' ? polishCoworkText(answer.reply) : '';
  if (!reply.trim()) return null;
  const cards = Array.isArray(answer.blocks) ? answer.blocks.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const card = item as Record<string, unknown>;
    if (typeof card.type !== 'string' || !(card.type in CARD_PARTS)) return [];
    const field = card[CARD_PARTS[card.type]];
    const parts = Array.isArray(field) ? field.length : typeof field === 'string' && field ? 1 : 0;
    return [{ type: card.type, title: typeof card.title === 'string' && card.title.trim() ? card.title.trim() : null, parts }];
  }) : [];
  return { reply, cards };
}
