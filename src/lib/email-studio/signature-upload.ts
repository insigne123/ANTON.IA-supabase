import {
  hasPendingImages, importSignatureHtml, placeUploadedImages, SIGNATURE_MAX_IMAGE_BYTES,
} from '@/lib/email-studio/signature-import';
import { supabase } from '@/lib/supabase';

/** An image of the signature, uploaded to the public storage every email reads it from. */
export async function storeSignatureImage(file: Blob, type: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
  const extension = type === 'image/png' ? 'png' : type === 'image/gif' ? 'gif' : 'jpg';
  const key = `signatures/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  const { error } = await supabase.storage.from('public').upload(key, file, { cacheControl: '3600', upsert: false, contentType: type });
  if (error) throw error;
  return supabase.storage.from('public').getPublicUrl(key).data.publicUrl;
}

export type PreparedSignature =
  | { ok: true; html: string; uploaded: number; failed: number; dropped: number }
  | { ok: false; problem: 'empty' | 'too_long' | 'failed' };

/**
 * A signature as it was pasted, read from its file or brought from the mailbox: cleaned, with each embedded image uploaded so
 * it reaches whoever reads the email. «Firmas y estilo» and the automatic import share it, so both save the same thing.
 */
export async function prepareSignature(raw: string, view: Window & { DOMParser: typeof DOMParser }): Promise<PreparedSignature> {
  const result = importSignatureHtml(raw, view);
  if (!result.html) return { ok: false, problem: 'empty' };
  if (result.tooLong) return { ok: false, problem: 'too_long' };
  const uploaded = await Promise.all(result.embedded.map(async image => {
    try {
      const blob = await (await fetch(image.dataUrl)).blob();
      return blob.size > SIGNATURE_MAX_IMAGE_BYTES ? null : await storeSignatureImage(blob, image.type);
    } catch {
      return null;
    }
  }));
  const html = placeUploadedImages(result.html, uploaded);
  if (hasPendingImages(html) || !html.trim()) return { ok: false, problem: 'failed' };
  const failed = uploaded.filter(url => !url).length;
  return { ok: true, html, uploaded: uploaded.length - failed, failed, dropped: result.dropped };
}
