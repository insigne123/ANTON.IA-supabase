/**
 * A first check on the files Cowork opens that are ZIP inside (Excel and Word, plan 2, F1 and F2): it
 * reads only the central directory, without unpacking anything, and refuses one whose contents would
 * expand far beyond its size (a «zip bomb»), that holds too many entries, or that needs ZIP64. The sizes
 * it reads are the ones the file declares, so this stops accidents and crude attacks, not a file that
 * lies about them: the upload limit (20 MB) and the reader's own limits are the rest of the defense.
 */
export const COWORK_ZIP_LIMITS = { entries: 2000, expandedBytes: 150 * 1024 * 1024, ratio: 200 } as const;

/** ok: what the file declares (its parts, the size they expand to and how much of that is XML); not ok: why, and `large` when it is a matter of size and not of a broken file. */
export type CoworkZipVerdict = { ok: true; entries: number; expandedBytes: number; xmlBytes: number } | { ok: false; reason: string; large?: true };

const END = 0x06054b50;
const ENTRY = 0x02014b50;

export function coworkZipGuard(bytes: Uint8Array, limits: { entries: number; expandedBytes: number; ratio: number } = COWORK_ZIP_LIMITS): CoworkZipVerdict {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record sits in the last 22 bytes plus a comment of up to 65 535.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === END) { end = at; break; }
  }
  if (end < 0) return { ok: false, reason: 'No es un archivo ZIP válido.' };
  const entries = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (entries === 0xffff || size === 0xffffffff || offset === 0xffffffff) return { ok: false, reason: 'El archivo usa un formato ZIP que no se abre.', large: true };
  if (entries > limits.entries) return { ok: false, reason: 'El archivo tiene demasiadas partes.', large: true };
  if (offset + size > end) return { ok: false, reason: 'No es un archivo ZIP válido.' };
  let at = offset;
  let expanded = 0;
  let xml = 0;
  for (let index = 0; index < entries; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== ENTRY) return { ok: false, reason: 'No es un archivo ZIP válido.' };
    const declared = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    expanded += declared;
    if (at + 46 + nameLength <= end && /\.xml$/i.test(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)))) xml += declared;
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (expanded > limits.expandedBytes) return { ok: false, reason: 'El archivo es demasiado grande al abrirlo.', large: true };
  }
  if (expanded > bytes.length * limits.ratio) return { ok: false, reason: 'El archivo es demasiado grande al abrirlo.', large: true };
  return { ok: true, entries, expandedBytes: expanded, xmlBytes: xml };
}
