import type { SupabaseClient } from '@supabase/supabase-js';
import { COWORK_UPLOAD_BUCKET } from './uploads';

export const COWORK_UPLOAD_MAX_FILES = 8;
export const COWORK_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['csv', 'json', 'md', 'txt', 'xlsx']);

/** Where files attached from the message box wait, in the person's own prefix,
 * before the message that uses them creates its run. */
export const COWORK_ATTACHMENTS_FOLDER = 'adjuntos';

/** An upload refused with a message for the person (400) or a storage failure (503). */
export class CoworkUploadRejected extends Error {
  constructor(message: string, readonly status: 400 | 503 = 400) {
    super(message);
    this.name = 'CoworkUploadRejected';
  }
}

export function coworkUploadName(raw: string) {
  const name = String(raw || '').trim();
  if (!name || name.length > 120 || name !== String(raw || '').trim() || name.includes('/') || name.includes('\\')
    || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.startsWith('.')) {
    throw new CoworkUploadRejected(`Nombre de archivo inválido: ${name.slice(0, 40)}`);
  }
  const dot = name.lastIndexOf('.');
  if (dot < 1 || !ALLOWED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) {
    throw new CoworkUploadRejected(`Extensión no permitida (csv, json, md, txt, xlsx): ${name.slice(0, 40)}`);
  }
  return name;
}

/** Saves the files of an upload form under `prefix`, lower-cased like every upload. Nothing is read or run here. */
export async function saveCoworkUploads(client: SupabaseClient, prefix: string, entries: FormDataEntryValue[]) {
  if (entries.length === 0) throw new CoworkUploadRejected('Adjunta al menos un archivo.');
  if (entries.length > COWORK_UPLOAD_MAX_FILES) throw new CoworkUploadRejected(`Máximo ${COWORK_UPLOAD_MAX_FILES} archivos por subida.`);
  const saved: Array<{ name: string; size: number }> = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) throw new CoworkUploadRejected('Archivo inválido.');
    const name = coworkUploadName(entry.name);
    const bytes = Buffer.from(await entry.arrayBuffer());
    if (bytes.length === 0) throw new CoworkUploadRejected(`El archivo ${name} está vacío.`);
    if (bytes.length > COWORK_UPLOAD_MAX_BYTES) throw new CoworkUploadRejected(`El archivo ${name} supera 20 MB.`);
    const uploaded = await client.storage.from(COWORK_UPLOAD_BUCKET)
      .upload(`${prefix}/${name.toLowerCase()}`, bytes, { upsert: true, contentType: entry.type || 'application/octet-stream' });
    if (uploaded.error) throw new CoworkUploadRejected('No se pudo guardar el archivo.', 503);
    saved.push({ name: name.toLowerCase(), size: bytes.length });
  }
  return saved;
}
