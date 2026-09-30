import { COWORK_STARTERS, type CoworkStarter } from './starters';

/**
 * The composer's shortcuts (plan 2, V6): «@» names a saved contact and «/» picks a template. Only the
 * rules live here; the composer draws the list and the workspace sends the message.
 *
 * A mention travels as «@Nombre» in the text and, at the end of the message, as «(ID de Nombre: <uuid>)»:
 * the model reads who it is without searching by name, the bubble shows the name as a chip and the ID
 * stays out of sight (coworkDisplayMessage).
 */

export type CoworkMention = { id: string; name: string };
export type CoworkComposerToken = { kind: 'mention' | 'template'; start: number; end: number; query: string };

const UUID = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
/** «(ID de Marcela Rojas: 3f…)», one per mentioned person, at the end of a message. */
const REFERENCE = new RegExp(`\\(ID de ([^():\\n]{1,80}): (${UUID})\\)`, 'gi');
const PART_OF_NAME = /[\p{L}\p{M}\p{N}_'-]/u;
const PART_OF_ADDRESS = /[\p{L}\p{M}\p{N}_@]/u;

/** A complete mention, not a prefix of a name the person kept editing or part of an email address. */
function mentionIndex(text: string, tag: string) {
  let index = text.indexOf(tag);
  while (index >= 0) {
    if (!PART_OF_ADDRESS.test(text[index - 1] || '') && !PART_OF_NAME.test(text[index + tag.length] || '')) return index;
    index = text.indexOf(tag, index + tag.length);
  }
  return -1;
}

/** A name as it travels in a mention: one line, without the signs a reference uses. */
export function coworkMentionName(name: string) {
  return String(name || '').replace(/[():\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * The shortcut typed right before the caret, or null. «@mar» counts at the start or after a space;
 * «/mej» only while it is the whole message (a slash inside a sentence is text).
 */
export function coworkComposerToken(text: string, caret: number): CoworkComposerToken | null {
  const before = text.slice(0, caret);
  const slash = /^\/([\p{L}\p{N}-]{0,24})$/u.exec(before);
  if (slash && !text.slice(caret).trim()) return { kind: 'template', start: 0, end: caret, query: slash[1] };
  const at = /(?:^|\s)@([\p{L}\p{N}._'-]{0,30})$/u.exec(before);
  if (!at) return null;
  return { kind: 'mention', start: caret - at[1].length - 1, end: caret, query: at[1] };
}

/** The text with the picked contact in place of what was typed, and where the caret goes (after the name and a space). */
export function coworkInsertMention(text: string, token: CoworkComposerToken, name: string) {
  const inserted = `@${coworkMentionName(name)} `;
  const after = text.slice(token.end).replace(/^[^\S\n]+/, '');
  return { text: `${text.slice(0, token.start)}${inserted}${after}`, caret: token.start + inserted.length };
}

/** The message as it is sent: the references of the mentions still in the text, once per person, at the end. */
export function coworkWithMentions(text: string, mentions: CoworkMention[]) {
  const seen = new Set<string>();
  const references = mentions.flatMap(mention => {
    const name = coworkMentionName(mention.name);
    // Identical visible tags cannot tell two different people apart after one is edited away.
    if (!name || seen.has(mention.id) || mentionIndex(text, `@${name}`) < 0
      || mentions.some(other => other.id !== mention.id && coworkMentionName(other.name) === name)) return [];
    seen.add(mention.id);
    const reference = `(ID de ${name}: ${mention.id})`;
    return text.includes(reference) ? [] : [reference];
  });
  return references.length ? `${text.trimEnd()}\n\n${references.join('\n')}` : text;
}

/** The people a sent message mentions, read from its references. */
export function coworkMessageMentions(message: string): CoworkMention[] {
  const found: CoworkMention[] = [];
  for (const match of String(message || '').matchAll(REFERENCE)) {
    if (!found.some(mention => mention.id === match[2].toLowerCase())) found.push({ name: match[1].trim(), id: match[2].toLowerCase() });
  }
  return found;
}

/** The text split where each mention appears («@Marcela Rojas»), so the bubble can show them as chips. */
export function coworkMentionSegments(text: string, mentions: CoworkMention[]): Array<{ text: string; mention: CoworkMention | null }> {
  const names = mentions.map(mention => ({ mention, tag: `@${mention.name}` })).sort((a, b) => b.tag.length - a.tag.length);
  const segments: Array<{ text: string; mention: CoworkMention | null }> = [];
  let rest = text;
  while (rest) {
    let first: { index: number; tag: string; mention: CoworkMention } | null = null;
    for (const { mention, tag } of names) {
      const index = mentionIndex(rest, tag);
      if (index >= 0 && (!first || index < first.index)) first = { index, tag, mention };
    }
    if (!first) { segments.push({ text: rest, mention: null }); break; }
    if (first.index > 0) segments.push({ text: rest.slice(0, first.index), mention: null });
    segments.push({ text: first.tag, mention: first.mention });
    rest = rest.slice(first.index + first.tag.length);
  }
  return segments;
}

const plain = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The templates «/» offers, the home's starters, narrowed by what follows the slash (title or name, without accents). */
export function coworkTemplates(query: string): CoworkStarter[] {
  const asked = plain(query.trim());
  return asked ? COWORK_STARTERS.filter(starter => plain(`${starter.title} ${starter.id}`).includes(asked)) : COWORK_STARTERS;
}

/** Where a template's [placeholder] is, to select it for the person to type over; null when it has none. */
export function coworkTemplateBlank(prompt: string): { start: number; end: number } | null {
  const start = prompt.indexOf('[');
  const end = prompt.indexOf(']', start);
  return start >= 0 && end > start ? { start, end: end + 1 } : null;
}
