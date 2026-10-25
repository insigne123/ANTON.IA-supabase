import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImageBlock } from '@/lib/agent-harness/types';
import { coworkImageType, type CoworkImageType } from '@/lib/cowork/file-read';
import { downloadCoworkUpload, findCoworkUpload } from './extended-reads';

type Scope = { userId: string; organizationId: string };
type Image = { bytes: Uint8Array; type: CoworkImageType };

/** The longest side Claude looks at without shrinking it itself: a larger picture costs the same and travels heavier. */
export const COWORK_IMAGE_MAX_SIDE = 1568;
/** One image as the API takes it (5 MB once in base64). */
export const COWORK_IMAGE_MAX_BYTES = 3_750_000;

/** The picture made smaller, turned upright and without its metadata (where it was taken, the camera). It throws where sharp is missing. */
async function shrink(image: Image): Promise<Image | null> {
  const sharp = (await import('sharp')).default;
  const resized = () => sharp(Buffer.from(image.bytes), { limitInputPixels: 50_000_000 }).rotate()
    .resize({ width: COWORK_IMAGE_MAX_SIDE, height: COWORK_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  // A screenshot stays PNG so its text stays sharp, unless that makes it too heavy; a photo goes as JPG.
  if (image.type === 'image/png') {
    const png = await resized().png({ compressionLevel: 9 }).toBuffer();
    if (png.length <= COWORK_IMAGE_MAX_BYTES) return { bytes: new Uint8Array(png), type: 'image/png' };
  }
  if (image.type === 'image/webp') return { bytes: new Uint8Array(await resized().webp({ quality: 85 }).toBuffer()), type: 'image/webp' };
  return { bytes: new Uint8Array(await resized().flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer()), type: 'image/jpeg' };
}

/**
 * An image of the person's own uploads, by the name files.read found, as the agent sees it (COW-11). It is checked to be the
 * image its name says, made smaller and stripped of its metadata; without sharp it goes as it came when it is light enough.
 */
export async function coworkImageBlock(client: SupabaseClient, scope: Scope, name: string, resize: (image: Image) => Promise<Image | null> = shrink): Promise<ImageBlock> {
  const found = await findCoworkUpload(client, scope, name);
  if (!found.found) throw new Error('No encontré la imagen.');
  const bytes = await downloadCoworkUpload(client, scope, found.upload);
  const type = coworkImageType(bytes);
  if (!type) throw new Error('El archivo no es una imagen PNG, JPG o WEBP.');
  const image = await resize({ bytes, type }).catch(() => null) ?? { bytes, type };
  if (image.bytes.length > COWORK_IMAGE_MAX_BYTES) throw new Error('La imagen es demasiado pesada para mirarla.');
  return { type: 'image', source: { type: 'base64', media_type: image.type, data: Buffer.from(image.bytes).toString('base64') } };
}
