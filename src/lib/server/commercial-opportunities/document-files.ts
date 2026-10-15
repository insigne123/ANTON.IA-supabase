// File names and legacy formats of the expediente's documents. Pure: no database, no request context.

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
/** Word 97-2003 (.doc) and Excel 97-2003 (.xls), common in public forms: the bucket keeps text only, so they are read as text. */
export async function opportunityLegacyAsText(name: string, bytes: Uint8Array): Promise<{ name: string; bytes: Uint8Array } | null> {
  const ext = name.toLowerCase().split('.').pop();
  if (ext !== 'doc' && ext !== 'xls') return null;
  const ole = bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!ole) throw new DocumentFileError(`«${name.slice(0, 120)}» no es un archivo de Word o Excel válido.`);
  let text = '';
  try {
    if (ext === 'doc') {
      const { default: WordExtractor } = await import('word-extractor');
      const doc = await new WordExtractor().extract(Buffer.from(bytes));
      text = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()].filter(Boolean).join('\n\n');
    } else {
      const XLSX = await import('xlsx');
      const book = XLSX.read(Buffer.from(bytes), { type: 'buffer', sheetRows: 2000 });
      text = book.SheetNames.slice(0, 12).map(sheet => `Hoja ${sheet}\n${XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, blankrows: false, defval: '' })
        .map(row => row.map(cell => String(cell).trim()).join(' | ')).join('\n')}`).join('\n\n');
    }
  } catch { throw new DocumentFileError(`No pudimos leer «${name.slice(0, 120)}». Guárdalo como PDF o Word (.docx) y vuelve a subirlo.`); }
  if (!text.trim()) throw new DocumentFileError(`«${name.slice(0, 120)}» no tiene texto legible.`);
  return { name: `${name.replace(/\.(doc|xls)$/i, '')} (texto del ${ext === 'doc' ? 'Word' : 'Excel'}).txt`, bytes: new TextEncoder().encode(text.replace(/\r\n?/g, '\n')) };
}
