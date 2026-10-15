/**
 * Mercado Público hands the bases and annexes as one ZIP («Descargar todos»). The browser opens it and sends each document
 * inside on its own, through the same upload as a file chosen by hand: the server checks every one as usual.
 */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md', '.csv'];
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 40;
const MAX_TOTAL = 150 * 1024 * 1024;

export type ZipNote = { name: string; message: string };
export const isZip = (file: Pick<File, 'name' | 'type'>) => /\.zip$/i.test(file.name) || /zip/i.test(file.type);
const extension = (name: string) => (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();

/** Windows-made ZIPs (Mercado Público's among them) store names in Windows-1252, not UTF-8: «Bases Técnicas.pdf» stays readable. */
export function decodeZipName(bytes: Uint8Array | ArrayLike<number> | string) {
  if (typeof bytes === 'string') return bytes;
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return new TextDecoder('windows-1252').decode(data); }
}

/** Each picked file as it goes up: documents as they are, and the documents inside each ZIP, with a note for what was left out. */
export async function expandZipUploads(picked: File[], load: (data: ArrayBuffer) => Promise<{ files: Record<string, ZipEntry> }> = defaultLoad) {
  const files: File[] = [];
  const notes: ZipNote[] = [];
  let total = 0;
  for (const file of picked) {
    if (!isZip(file)) { files.push(file); continue; }
    let zip;
    try { zip = await load(await file.arrayBuffer()); } catch { notes.push({ name: file.name, message: 'No pudimos abrir este ZIP. Descomprímelo y sube los archivos uno por uno.' }); continue; }
    const entries = Object.values(zip.files).filter(entry => !entry.dir && !/(^|\/)(__MACOSX|\.)/.test(entry.name));
    let added = 0; let other = 0; let large = 0; let over = 0;
    for (const entry of entries) {
      const name = entry.name.split('/').pop() || entry.name;
      if (!DOCUMENT_EXTENSIONS.includes(extension(name))) { other++; continue; }
      if (added >= MAX_FILES) { over++; continue; }
      // The declared size first, so a ZIP bomb is not inflated in memory to find out.
      const declared = Number(entry._data?.uncompressedSize);
      if (Number.isFinite(declared) && declared > MAX_FILE) { large++; continue; }
      const blob = await entry.async('blob');
      if (blob.size > MAX_FILE) { large++; continue; }
      if (total + blob.size > MAX_TOTAL) { over++; continue; }
      total += blob.size; added++;
      files.push(new File([blob], name, { type: blob.type }));
    }
    const left = [other && `${other} ${other === 1 ? 'archivo no es' : 'archivos no son'} PDF, Word, Excel ni texto`,
      large && `${large} ${large === 1 ? 'supera' : 'superan'} 20 MB`, over && `${over} ${over === 1 ? 'quedó' : 'quedaron'} fuera por el máximo de ${MAX_FILES} archivos por ZIP`].filter(Boolean);
    if (!added) notes.push({ name: file.name, message: `El ZIP no trae bases ni anexos que podamos leer${left.length ? ` (${left.join('; ')})` : ''}.` });
    else if (left.length) notes.push({ name: file.name, message: `Subimos ${added} ${added === 1 ? 'documento' : 'documentos'} del ZIP; ${left.join('; ')}.` });
  }
  return { files, notes };
}

export type ZipEntry = { name: string; dir: boolean; _data?: { uncompressedSize?: number }; async: (type: 'blob') => Promise<Blob> };
async function defaultLoad(data: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  return JSZip.loadAsync(data, { decodeFileName: decodeZipName as never }) as unknown as Promise<{ files: Record<string, ZipEntry> }>;
}
