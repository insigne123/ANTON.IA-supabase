// The notes of the activity (OPP-28): whose can be edited or deleted, and «@Diego Fuentes» in them: what the box suggests while a name is
// typed after «@», who a note names among the people who can read the opportunity (so they hear about it), and the note in pieces to show
// the names apart. A name is the person's whole name as the app shows it, so two «Diego» are told apart by their surname. Pure: the page,
// the API and the tests share it.
import { z } from 'zod';

/** What a person writes in the activity: their own can be edited and deleted. Decisions, blocks and the lines the app writes cannot. */
export const NOTE_KINDS = ['note', 'progress', 'meeting'] as const;
export const isEditableNote = (row: { kind?: string | null; actor_id?: string | null }, userId: string | null | undefined) =>
  Boolean(userId) && row.actor_id === userId && (NOTE_KINDS as readonly string[]).includes(String(row.kind));
export const noteEditSchema = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(4000) }).strict();
export const noteDeleteSchema = z.object({ id: z.string().uuid() }).strict();

export type MentionPerson = { user_id: string; name: string };

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
const WORD = /[\p{L}\p{N}]/u;

/** The name being typed after an «@» just before the caret («Hola @die» → «die»); none in an e-mail address, across lines or after two spaces. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0 || (start > 0 && WORD.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  return query.length > 40 || /[\n@]|\s{2}|^\s/.test(query) ? null : { start, query };
}

/**
 * Who matches what was typed: the start of their name or of any of its words, without minding accents; six at most. A whole name
 * followed by a space is a mention already made: nothing more to suggest («@Ana » closes; «@Ana M» suggests «Ana María Soto»).
 */
export function mentionMatches<T extends MentionPerson>(people: T[], query: string, limit = 6): T[] {
  const typed = fold(query.trim());
  if (/\s$/.test(query) && people.some(person => fold(person.name.trim()) === typed)) return [];
  return people.filter(person => person.name.trim() && (!typed || fold(person.name).startsWith(typed) || fold(person.name).split(/\s+/).some(word => word.startsWith(typed)))).slice(0, limit);
}

/** The text with the chosen name in place of what was typed, and where the caret goes: after the name and the space that follows it. */
export function insertMention(text: string, at: { start: number; query: string }, name: string) {
  const rest = text.slice(at.start + 1 + at.query.length);
  // A comma or a space already there follows the name as it is; otherwise a space is added to go on writing.
  const glue = /^[\s,.;:!?)»]/.test(rest) ? '' : ' ';
  const before = `${text.slice(0, at.start)}@${name}${glue}`;
  return { text: `${before}${rest}`, caret: before.length + (!glue && /^\s/.test(rest) ? 1 : 0) };
}

/** The note in pieces, plain text and the people it names, the longest names first so «@Ana María Soto» is not taken for «@Ana María». */
export function mentionParts(text: string, people: MentionPerson[]): Array<{ text: string; userId?: string }> {
  const names = people.filter(person => person.name.trim()).map(person => ({ id: person.user_id, name: fold(person.name.trim()) })).sort((a, b) => b.name.length - a.name.length);
  const folded = fold(text);
  // Folding keeps one character per character only when nothing was decomposed; otherwise the note is read without highlights.
  if (folded.length !== text.length || !names.length) return text ? [{ text }] : [];
  const parts: Array<{ text: string; userId?: string }> = [];
  let plain = 0;
  for (let index = text.indexOf('@'); index >= 0; index = text.indexOf('@', index + 1)) {
    if (index > 0 && WORD.test(text[index - 1])) continue;
    const found = names.find(person => folded.startsWith(person.name, index + 1) && !WORD.test(text[index + 1 + person.name.length] ?? ''));
    if (!found) continue;
    if (index > plain) parts.push({ text: text.slice(plain, index) });
    const end = index + 1 + found.name.length;
    parts.push({ text: text.slice(index, end), userId: found.id });
    plain = end;
    index = end - 1;
  }
  if (plain < text.length) parts.push({ text: text.slice(plain) });
  return parts;
}

/** The people a note names, each once, in the order they appear. */
export const mentionedPeople = (text: string, people: MentionPerson[]) =>
  [...new Set(mentionParts(text, people).flatMap(part => (part.userId ? [part.userId] : [])))];
