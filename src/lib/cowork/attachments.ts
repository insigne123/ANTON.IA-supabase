/**
 * Files attached to a message travel as its last lines, so the model reads them
 * by name and the chat shows them apart from the text:
 *
 *   ¿A quién le escribo primero?
 *
 *   Adjuntos:
 *   - asistentes-feria.csv
 */
const BLOCK = /(?:^|\n+)Adjuntos:\n((?:- [^\n]+(?:\n|$))+)$/;

/** The message with its attachments, one per line; the text alone when there are none. */
export function coworkWithAttachments(text: string, names: string[]) {
  const files = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  const body = text.trim();
  if (!files.length) return body;
  return [body, `Adjuntos:\n${files.map(name => `- ${name}`).join('\n')}`].filter(Boolean).join('\n\n');
}

/** The text the person wrote and the files attached to it. */
export function coworkMessageAttachments(message: string): { text: string; files: string[] } {
  const value = String(message || '');
  const match = BLOCK.exec(value);
  if (!match) return { text: value, files: [] };
  return {
    text: value.slice(0, match.index).trimEnd(),
    files: match[1].split('\n').map(line => line.replace(/^- /, '').trim()).filter(Boolean),
  };
}
