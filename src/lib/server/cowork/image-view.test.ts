import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { COWORK_IMAGE_MAX_BYTES, COWORK_IMAGE_MAX_SIDE, coworkImageBlock } from './image-view';

const scope = { userId: 'user-1', organizationId: 'org-1' };

/** The person's uploads: one run folder with its files and their bytes; records every path touched. */
function uploadsClient(files: Record<string, Uint8Array>) {
  const paths: string[] = [];
  const client = { storage: { from: (bucket: string) => ({
    list: async (prefix: string) => {
      paths.push(prefix);
      if (prefix === 'org-1/user-1') return { data: [{ name: 'run-1' }], error: null };
      return { data: Object.entries(files).map(([name, bytes]) => ({ name, updated_at: '2026-10-25T02:00:00Z', metadata: { size: bytes.length } })), error: null };
    },
    download: async (path: string) => {
      paths.push(`${bucket}:${path}`);
      const bytes = files[path.split('/').pop() || ''];
      return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'not found' } };
    },
  }) } };
  return { client, paths };
}

const picture = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } });

test('a big screenshot goes smaller, still a PNG, from the person\'s own uploads only (COW-11)', async () => {
  const { client, paths } = uploadsClient({ 'captura.png': new Uint8Array(await picture(3000, 1200).png().toBuffer()) });
  const block = await coworkImageBlock(client as never, scope, 'captura.png');
  assert.equal(block.type, 'image');
  assert.equal(block.source.media_type, 'image/png');
  const seen = await sharp(Buffer.from(block.source.data, 'base64')).metadata();
  assert.equal(seen.width, COWORK_IMAGE_MAX_SIDE);
  assert.equal(seen.height, Math.round(1200 * COWORK_IMAGE_MAX_SIDE / 3000));
  assert.ok(paths.every(path => path.replace(/^cowork-uploads:/, '').startsWith('org-1/user-1')));
});

test('a photo is turned upright and loses where it was taken; a small one keeps its size', async () => {
  const photo = await picture(400, 300).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Camara del telefono' } } }).toBuffer();
  const { client } = uploadsClient({ 'tarjeta.jpg': new Uint8Array(photo) });
  const block = await coworkImageBlock(client as never, scope, 'tarjeta');
  assert.equal(block.source.media_type, 'image/jpeg');
  const seen = await sharp(Buffer.from(block.source.data, 'base64')).metadata();
  // Orientation 6 is a phone held upright: the picture is turned, so it is taller than wide.
  assert.deepEqual([seen.width, seen.height], [300, 400]);
  assert.equal(seen.exif, undefined);
  assert.equal(seen.orientation, undefined);
});

test('a file named like an image that is not one, a missing one and a heavy one without sharp are not looked at', async () => {
  const { client } = uploadsClient({ 'lista.png': new TextEncoder().encode('Nombre,Correo\nMarcela,m@x.cl') });
  await assert.rejects(coworkImageBlock(client as never, scope, 'lista.png'), /no es una imagen PNG, JPG o WEBP/);
  await assert.rejects(coworkImageBlock(client as never, scope, 'otra.png'), /No encontré la imagen/);
  // Where sharp is missing the picture goes as it came, when it is light enough for the API.
  const noSharp = async () => { throw new Error('sharp no está'); };
  const small = new Uint8Array(await picture(200, 100).png().toBuffer());
  const light = uploadsClient({ 'chica.png': small });
  assert.equal((await coworkImageBlock(light.client as never, scope, 'chica.png', noSharp)).source.data, Buffer.from(small).toString('base64'));
  const heavy = new Uint8Array(COWORK_IMAGE_MAX_BYTES + 1);
  heavy.set([0xff, 0xd8, 0xff]);
  await assert.rejects(coworkImageBlock(uploadsClient({ 'pesada.jpg': heavy }).client as never, scope, 'pesada.jpg', noSharp), /demasiado pesada/);
});
