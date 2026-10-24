import { PREFILL_MAX_CHARS } from './prefill';

/**
 * «Cargar oportunidad» from a package: a private process arrives as several documents (the invitation, the general and particular
 * conditions, the technical bases, the framework contract, the annexes), often inside ZIPs. The model reads them together, so what
 * decides the form (who invites, the platform, the schedule) must not be cut off by a long document that comes before it. Pure.
 */
export const PREFILL_MAX_FILES = 8;
export const PREFILL_MAX_BYTES = 24 * 1024 * 1024;

export type PackageDocument = { name: string; sections: Array<{ locator: string; text: string }> };

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** How early a document is read: 0 names the process (invitation, particular conditions) … 6 is the law the bases quote. */
export function prefillRank(name: string) {
  const text = fold(name);
  // The e-mail that brought the process is the invitation itself (OPP-49).
  if (/particular|invitacion|ficha resumen|^correo |(^|\s)(eml|msg)$/.test(text)) return 0;
  if (/decreto|reglamento|normativa|\bley\b/.test(text)) return 6;
  if (/tecnic|alcance|especificacion/.test(text)) return 2;
  if (/contrato/.test(text)) return 4;
  if (/anexo|formulario|formato|cotizacion/.test(text)) return 3;
  if (/bases|condicionado|solicitud de propuestas|\brfp\b|terminos de referencia|\btdr\b/.test(text)) return 1;
  return 5;
}

/**
 * Which files of a package go to the reading, best first: the ones that define the process, within the limits of one request. The
 * rest still go up with the opportunity. A law or a regulation never defines the process, so it is only read when nothing else is.
 */
export function pickPrefillFiles<T extends { name: string; size: number }>(files: T[], limits = { max: PREFILL_MAX_FILES, bytes: PREFILL_MAX_BYTES }) {
  const ranked = files.map((file, index) => ({ file, index, rank: prefillRank(file.name) })).sort((a, b) => a.rank - b.rank || a.index - b.index);
  const useful = ranked.some(item => item.rank < 6) ? ranked.filter(item => item.rank < 6) : ranked;
  const chosen: T[] = [];
  let bytes = 0;
  for (const { file } of useful) {
    if (chosen.length >= limits.max || bytes + file.size > limits.bytes) continue;
    chosen.push(file); bytes += file.size;
  }
  return { chosen, skipped: files.filter(file => !chosen.includes(file)) };
}

const fullText = (sections: PackageDocument['sections']) => sections.map(section => {
  const body = section.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return body ? `[${section.locator}]\n${body}` : '';
}).filter(Boolean).join('\n\n');

// Where a process says its dates, platform and money: kept even when the document is cut.
const KEY_LINES = /cronograma|calendario|hito|entrega de (?:las )?(?:ofertas|propuestas)|plataforma|administrador del proceso|garant[ií]a|vigencia|moneda|monto|presupuesto/i;
const WINDOW = 700;

/** A long document cut to `room` characters: its start, then the passages around the lines that carry the process' key data. */
function excerpt(text: string, room: number) {
  if (text.length <= room) return text;
  const head = Math.floor(room * 0.55);
  const parts = [text.slice(0, head).trimEnd()];
  let used = head, last = head;
  for (const match of text.matchAll(new RegExp(KEY_LINES, 'gi'))) {
    const at = match.index ?? 0;
    if (at < last) continue;
    const from = Math.max(last, text.lastIndexOf('\n', at) + 1);
    const piece = text.slice(from, from + WINDOW).trimEnd();
    if (used + piece.length + 6 > room) break;
    parts.push(piece); used += piece.length + 6; last = from + WINDOW;
  }
  return parts.join('\n[…]\n');
}

/**
 * The text the model reads for a package: every document under its name, in reading order. Each one gets an equal share (the
 * process-defining ones weigh double); a short one gives back what it does not use, a long one is cut keeping its key passages.
 */
export function prefillPackageText(documents: PackageDocument[], budget = PREFILL_MAX_CHARS) {
  const docs = documents.map((doc, index) => ({ doc, index, rank: prefillRank(doc.name), text: fullText(doc.sections) }))
    .filter(item => item.text).sort((a, b) => a.rank - b.rank || a.index - b.index);
  const title = (name: string) => `=== Documento «${name.slice(0, 160)}» ===\n`;
  let left = budget - docs.reduce((sum, item) => sum + title(item.doc.name).length + 2, 0);
  const allotted = new Map<typeof docs[number], number>();
  const weight = (item: typeof docs[number]) => (item.rank <= 1 ? 2 : 1);
  let pending = docs.slice();
  for (;;) {
    const share = left / Math.max(1, pending.reduce((sum, item) => sum + weight(item), 0));
    const fits = pending.filter(item => item.text.length <= share * weight(item));
    if (!fits.length) { for (const item of pending) allotted.set(item, Math.max(0, Math.floor(share * weight(item)))); break; }
    for (const item of fits) { allotted.set(item, item.text.length); left -= item.text.length; }
    pending = pending.filter(item => !fits.includes(item));
    if (!pending.length) break;
  }
  let partial = false;
  const text = docs.map(item => {
    const room = allotted.get(item) ?? 0;
    if (item.text.length > room) partial = true;
    return `${title(item.doc.name)}${excerpt(item.text, room)}`;
  }).join('\n\n');
  return { text: text.slice(0, budget), partial };
}
