// File names and legacy formats of the expediente's documents. Pure: no database, no request context.
import { randomUUID } from 'node:crypto';
import { coworkZipGuard } from '@/lib/cowork/zip-guard';

/** A file the person sent that cannot be read; the message says why and what to do. */
export class DocumentFileError extends Error {}

/**
 * The storage key of a document: Supabase Storage refuses accents, «ñ» and «°», so a name like «Bases Técnicas N°2.pdf» or
 * «Preguntas y respuestas públicas.txt» failed before saving anything. The person keeps seeing the original name.
 */
export function opportunityStorageName(name: string) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').replace(/_+/g, '_').trim().slice(0, 150) || 'documento';
  return ext ? `${base}.${ext}` : base;
}
/** What each format read as text is called in the name of its copy: «Bases (texto del Word).txt». */
const TEXT_OF: Record<string, string> = {
  doc: 'del Word', docm: 'del Word', dotx: 'del Word', xls: 'del Excel', xlsm: 'del Excel', xltx: 'del Excel', xlsb: 'del Excel',
  ods: 'de la planilla', odt: 'del documento', rtf: 'del documento', odp: 'de la presentación', pptx: 'de la presentación',
};
/** The formats the bucket does not keep (it holds PDF, Word, Excel and text) but whose text can be read. */
export const TEXT_ONLY_FORMATS = Object.keys(TEXT_OF);
const ZIP_BASED = new Set(['docm', 'dotx', 'xlsm', 'xltx', 'xlsb', 'ods', 'odt', 'odp', 'pptx']);

const xmlEntities = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec))).replace(/&amp;/g, '&');
/** The text of an OpenDocument part (content.xml): paragraphs and headings on their own lines, tabs and spaces kept. */
export function openDocumentText(xml: string) {
  return xmlEntities(xml.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_, n) => ' '.repeat(Number(n) || 1))
    .replace(/<\/(text:p|text:h|table:table-row)>/g, '\n').replace(/<\/table:table-cell>/g, ' | ').replace(/<[^>]+>/g, ''))
    .replace(/ \| \n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** The text of a PowerPoint slide: each paragraph of its text boxes on its own line. */
export function slideText(xml: string) {
  return xmlEntities(xml.replace(/<a:br\/>/g, '\n').replace(/<\/a:p>/g, '\n').replace(/<(?!\/?a:t\b)[^>]+>/g, '').replace(/<\/?a:t\b[^>]*>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
/**
 * The text of an RTF document: its paragraphs, tabs, accents (\\'e1) and Unicode escapes (\\u241?), without the font,
 * color and style tables, pictures or other hidden groups.
 */
export function rtfText(rtf: string) {
  let out = ''; let depth = 0; let skipFrom = -1; let skipBytes = 0;
  const hidden = /^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|header|footer|footnote|\*)$/;
  for (let i = 0; i < rtf.length; i++) {
    const char = rtf[i];
    if (char === '{') { depth++; continue; }
    if (char === '}') { if (skipFrom === depth) skipFrom = -1; depth--; continue; }
    if (char === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') { if (skipFrom < 0) out += next; i++; continue; }
      if (next === "'") { if (skipFrom < 0 && !skipBytes) out += new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(rtf.slice(i + 2, i + 4), 16) || 32])); else if (skipBytes) skipBytes--; i += 3; continue; }
      const word = /^([a-z*]+)(-?\d+)? ?/i.exec(rtf.slice(i + 1));
      if (!word) { i++; continue; }
      i += word[0].length;
      const [, name, arg] = word;
      if (skipFrom < 0 && (hidden.test(name) || (name === '*'))) { skipFrom = depth; continue; }
      if (skipFrom >= 0) continue;
      if (name === 'par' || name === 'line' || name === 'row' || name === 'sect' || name === 'page') out += '\n';
      else if (name === 'tab' || name === 'cell') out += '\t';
      else if (name === 'u' && arg) { out += String.fromCharCode(Number(arg) < 0 ? Number(arg) + 65536 : Number(arg)); skipBytes = 1; }
      continue;
    }
    if (skipFrom >= 0 || char === '\r' || char === '\n') continue;
    if (skipBytes) { skipBytes--; continue; }
    out += char;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Formats the bucket does not keep but whose text can be read: Word and Excel 97-2003 (.doc, .xls), the macro and template
 * versions of Word and Excel, LibreOffice (.odt, .ods, .odp), PowerPoint (.pptx) and RTF. Mercado Público's ZIPs bring them
 * among the bases; each is kept as the text it holds, in a .txt that says what it was. null for every other format.
 */
export async function opportunityLegacyAsText(name: string, bytes: Uint8Array): Promise<{ name: string; bytes: Uint8Array } | null> {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (!TEXT_OF[ext]) return null;
  const short = name.slice(0, 120);
  if (ext === 'doc' || ext === 'xls') {
    const ole = bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    if (!ole) throw new DocumentFileError(`«${short}» no es un archivo de Word o Excel válido.`);
  }
  if (ZIP_BASED.has(ext)) {
    const guard = coworkZipGuard(bytes);
    if (!guard.ok) throw new DocumentFileError(`«${short}»: ${guard.reason}`);
  }
  let text = '';
  try {
    if (ext === 'doc') {
      const { default: WordExtractor } = await import('word-extractor');
      const doc = await new WordExtractor().extract(Buffer.from(bytes));
      text = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()].filter(Boolean).join('\n\n');
    } else if (ext === 'docm' || ext === 'dotx') {
      const mammoth = await import('mammoth'); const lib = mammoth.default ?? mammoth;
      text = (await lib.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } else if (ext === 'xls' || ext === 'xlsm' || ext === 'xltx' || ext === 'xlsb' || ext === 'ods') {
      const XLSX = await import('xlsx');
      const book = XLSX.read(Buffer.from(bytes), { type: 'buffer', sheetRows: 2000 });
      text = book.SheetNames.slice(0, 12).map(sheet => `Hoja ${sheet}\n${XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, blankrows: false, defval: '' })
        .map(row => row.map(cell => String(cell).trim()).join(' | ')).join('\n')}`).join('\n\n');
    } else if (ext === 'rtf') {
      text = rtfText(new TextDecoder('latin1').decode(bytes));
    } else {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(bytes);
      if (ext === 'pptx') {
        const slides = Object.keys(zip.files).map(path => /^ppt\/slides\/slide(\d+)\.xml$/.exec(path)).filter((match): match is RegExpExecArray => Boolean(match))
          .sort((a, b) => Number(a[1]) - Number(b[1])).slice(0, 200);
        const parts = [];
        for (const slide of slides) { const body = slideText(await zip.file(slide[0])!.async('string')); if (body) parts.push(`Diapositiva ${slide[1]}\n${body}`); }
        text = parts.join('\n\n');
      } else {
        const content = zip.file('content.xml');
        text = content ? openDocumentText(await content.async('string')) : '';
      }
    }
  } catch { throw new DocumentFileError(`No pudimos leer «${short}». Guárdalo como PDF o Word (.docx) y vuelve a subirlo.`); }
  if (!text.trim()) throw new DocumentFileError(`«${short}» no tiene texto legible.`);
  return { name: `${name.replace(/\.[^.]+$/, '')} (texto ${TEXT_OF[ext]}).txt`, bytes: new TextEncoder().encode(text.replace(/\r\n?/g, '\n')) };
}

/** A document's text as the fragments the report and the chat cite: up to 6,000 characters each, in reading order. */
export function opportunityTextChunks(sections: Array<{ locator: string; text: string }>) {
  let ordinal = 0;
  return sections.flatMap(section => {
    const parts = [];
    for (let i = 0; i < section.text.length; i += 6000) parts.push({ id: randomUUID(), ordinal: ordinal++, locator: `${section.locator}${section.text.length > 6000 ? ` · bloque ${Math.floor(i / 6000) + 1}` : ''}`, content: section.text.slice(i, i + 6000) });
    return parts;
  });
}
