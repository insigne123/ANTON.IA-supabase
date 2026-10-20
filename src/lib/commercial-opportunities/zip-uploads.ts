/**
 * Mercado Público hands the bases and annexes as one ZIP («Descargar todos»). The browser opens it and sends each document
 * inside on its own, through the same upload as a file chosen by hand: the server checks every one as usual.
 */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md', '.csv', '.html', '.htm',
  // Read as text on the server (document-files.ts): the macro and template versions of Word and Excel, LibreOffice, PowerPoint and RTF.
  '.docm', '.dotx', '.xlsm', '.xltx', '.xlsb', '.odt', '.ods', '.odp', '.pptx', '.rtf',
  // Photos and screenshots: the AI reads them as images (document-scans.ts).
  '.jpg', '.jpeg', '.png', '.gif', '.webp'];
/** Images in formats the AI does not read. */
const IMAGES = ['.tif', '.tiff', '.bmp', '.heic'];
const ARCHIVES = ['.rar', '.7z', '.tar', '.gz', '.tgz'];
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 40;
const MAX_TOTAL = 150 * 1024 * 1024;

export type ZipNote = { name: string; message: string };
export const isZip = (file: Pick<File, 'name' | 'type'>) => /\.zip$/i.test(file.name) || /zip/i.test(file.type);
const extension = (name: string) => (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();

// The upper half of IBM code page 850, the one Windows' «Enviar a carpeta comprimida» writes names in on Spanish systems.
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
const cp850 = (data: Uint8Array) => Array.from(data, byte => (byte < 0x80 ? String.fromCharCode(byte) : CP850[byte - 0x80])).join('');
/**
 * How Spanish a decoded name reads: accented lowercase among lowercase letters and accented capitals among capitals are
 * likely; a capital accent inside a lowercase word, a lowercase accent inside a capital word or a symbol such as «¥» or
 * a box line are not.
 */
function spanishScore(name: string) {
  let score = 0;
  const chars = Array.from(name);
  chars.forEach((char, i) => {
    if (char.charCodeAt(0) < 0x80) return;
    const near = `${chars[i - 1] || ''}${chars[i + 1] || ''}`;
    const upperNear = /[A-ZÁÉÍÓÚÑÜ]/.test(near) && !/[a-záéíóúñü]/.test(near);
    if (/[áéíóúñü]/.test(char)) score += upperNear ? -1 : 2;
    else if (/[ÁÉÍÓÚÑÜ]/.test(char)) score += /[a-z]/.test(near) ? -1 : 2;
    else if (/[°ºª¿¡«»·]/.test(char)) score += 1;
    else score -= 2;
  });
  return score;
}
/**
 * A ZIP entry name. UTF-8 when it is valid UTF-8; otherwise the same bytes read as code page 850 (Windows' own ZIPs, as
 * Mercado Público's «Descargar todos» arrives: «DISEÑOS_DE_DIFUSIÓN.pdf», «Nº1534») or as Windows-1252 (other tools:
 * «Bases Técnicas.pdf»), whichever reads as Spanish.
 */
export function decodeZipName(bytes: Uint8Array | ArrayLike<number> | string) {
  if (typeof bytes === 'string') return bytes;
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { /* a legacy code page */ }
  const oem = cp850(data);
  const ansi = new TextDecoder('windows-1252').decode(data);
  return spanishScore(ansi) > spanishScore(oem) ? ansi : oem;
}

type Left = { name: string; why: 'image' | 'archive' | 'other' | 'large' | 'over' };
/** «a», «b» y «c» (y 2 más). */
const names = (list: Left[]) => {
  const shown = list.slice(0, 3).map(item => `«${item.name}»`);
  const rest = list.length - shown.length;
  return rest ? `${shown.join(', ')} y ${rest} más` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} y ${shown.at(-1)}` : shown[0];
};
/** What was left out of a ZIP and why, by name, so the person knows which file to open on their own. */
function leftOut(left: Left[]) {
  const of = (why: Left['why']) => left.filter(item => item.why === why);
  const one = (list: Left[]) => list.length === 1;
  return [
    of('image').length && `${names(of('image'))} ${one(of('image')) ? 'es una imagen' : 'son imágenes'} en un formato que la IA no lee: ${one(of('image')) ? 'guárdala' : 'guárdalas'} como JPG o PNG y ${one(of('image')) ? 'súbela' : 'súbelas'}`,
    of('archive').length && `${names(of('archive'))} ${one(of('archive')) ? 'es otro comprimido' : 'son otros comprimidos'} (RAR o 7z): descomprímelo y sube lo que trae`,
    of('other').length && `${names(of('other'))} no ${one(of('other')) ? 'es un formato' : 'son formatos'} que podamos leer`,
    of('large').length && `${names(of('large'))} ${one(of('large')) ? 'supera' : 'superan'} 20 MB`,
    of('over').length && `${of('over').length} ${one(of('over')) ? 'quedó' : 'quedaron'} fuera por el máximo de ${MAX_FILES} archivos por ZIP`,
  ].filter(Boolean).join('; ');
}

/**
 * Each picked file as it goes up: documents as they are, and the documents inside each ZIP (and inside a ZIP within it),
 * with a note that names what was left out and why.
 */
export async function expandZipUploads(picked: File[], load: (data: ArrayBuffer) => Promise<{ files: Record<string, ZipEntry> }> = defaultLoad) {
  const files: File[] = [];
  const notes: ZipNote[] = [];
  let total = 0;
  for (const file of picked) {
    if (!isZip(file)) { files.push(file); continue; }
    let zip;
    try { zip = await load(await file.arrayBuffer()); } catch { notes.push({ name: file.name, message: 'No pudimos abrir este ZIP. Descomprímelo y sube los archivos uno por uno.' }); continue; }
    let added = 0;
    const left: Left[] = [];
    const take = async (opened: { files: Record<string, ZipEntry> }, depth: number) => {
      const entries = Object.values(opened.files).filter(entry => !entry.dir && !/(^|\/)(__MACOSX|\.)/.test(entry.name));
      for (const entry of entries) {
        const name = entry.name.split('/').pop() || entry.name;
        const ext = extension(name);
        // A ZIP inside the ZIP (annexes grouped by the buyer) is opened once; deeper ones are left out.
        if (ext === '.zip' && depth === 0) {
          try { await take(await load(await (await entry.async('blob')).arrayBuffer()), 1); } catch { left.push({ name, why: 'archive' }); }
          continue;
        }
        if (!DOCUMENT_EXTENSIONS.includes(ext)) { left.push({ name, why: IMAGES.includes(ext) ? 'image' : ARCHIVES.includes(ext) || ext === '.zip' ? 'archive' : 'other' }); continue; }
        if (added >= MAX_FILES) { left.push({ name, why: 'over' }); continue; }
        // The declared size first, so a ZIP bomb is not inflated in memory to find out.
        const declared = Number(entry._data?.uncompressedSize);
        if (Number.isFinite(declared) && declared > MAX_FILE) { left.push({ name, why: 'large' }); continue; }
        const blob = await entry.async('blob');
        if (blob.size > MAX_FILE) { left.push({ name, why: 'large' }); continue; }
        if (total + blob.size > MAX_TOTAL) { left.push({ name, why: 'over' }); continue; }
        total += blob.size; added++;
        files.push(new File([blob], name, { type: blob.type }));
      }
    };
    await take(zip, 0);
    const why = leftOut(left);
    if (!added) notes.push({ name: file.name, message: `El ZIP no trae bases ni anexos que podamos leer${why ? `: ${why}` : ''}.` });
    else if (why) notes.push({ name: file.name, message: `Del ZIP tomamos ${added} ${added === 1 ? 'documento' : 'documentos'}. ${why.charAt(0).toUpperCase()}${why.slice(1)}.` });
  }
  return { files, notes };
}

export type ZipEntry = { name: string; dir: boolean; _data?: { uncompressedSize?: number }; async: (type: 'blob') => Promise<Blob> };
async function defaultLoad(data: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  return JSZip.loadAsync(data, { decodeFileName: decodeZipName as never }) as unknown as Promise<{ files: Record<string, ZipEntry> }>;
}
