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

const PASTED_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/**
 * The images pasted into the message box (a screenshot, a picture copied from a page), named by when they were pasted so a second
 * one does not replace the first: «captura-20261025-021530.png». A paste that carries text is text: Excel puts a picture of the
 * cells next to them, and that paste is the cells.
 */
export function coworkPastedImages(data: Pick<DataTransfer, 'files' | 'getData'> | null, now: Date): File[] {
  if (!data || data.getData('text/plain').trim()) return [];
  const images = Array.from(data.files || []).filter(file => PASTED_EXTENSIONS[file.type]);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return images.map((file, index) => new File([file], `captura-${stamp}${images.length > 1 ? `-${index + 1}` : ''}.${PASTED_EXTENSIONS[file.type]}`, { type: file.type }));
}
