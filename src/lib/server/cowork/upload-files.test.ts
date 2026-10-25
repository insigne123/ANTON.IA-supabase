import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_UPLOAD_MAX_FILES, CoworkUploadRejected, coworkUploadName, saveCoworkUploads } from './upload-files';

function storage() {
  const uploads: Array<{ bucket: string; path: string; size: number; contentType?: string }> = [];
  const client = { storage: { from: (bucket: string) => ({
    upload: async (path: string, bytes: Buffer, options?: { contentType?: string }) => {
      uploads.push({ bucket, path, size: bytes.length, ...(options?.contentType?.startsWith('image/') ? { contentType: options.contentType } : {}) });
      return { data: { path }, error: null };
    },
  }) } };
  return { client, uploads };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

test('uploads are saved lower-cased under the prefix, with their sizes', async () => {
  const { client, uploads } = storage();
  const saved = await saveCoworkUploads(client as never, 'org-1/user-1/adjuntos', [new File(['a,b\n1,2'], 'Leads-Feria.CSV', { type: 'text/csv' })]);
  assert.deepEqual(saved, [{ name: 'leads-feria.csv', size: 7 }]);
  assert.deepEqual(uploads, [{ bucket: 'cowork-uploads', path: 'org-1/user-1/adjuntos/leads-feria.csv', size: 7 }]);
});

test('unsafe names, other kinds, empty files and too many files are refused before saving', async () => {
  for (const name of ['../x.csv', 'a/b.csv', '.env', 'animacion.gif', 'deck.pptx', 'sin-extension', 'linea\nnueva.csv']) {
    assert.throws(() => coworkUploadName(name), CoworkUploadRejected, name);
  }
  assert.equal(coworkUploadName('notas, feria.md'), 'notas, feria.md');
  assert.equal(coworkUploadName(' espacio.csv '), 'espacio.csv');
  const { client, uploads } = storage();
  await assert.rejects(saveCoworkUploads(client as never, 'p', [new File([''], 'vacio.csv')]), /está vacío/);
  await assert.rejects(saveCoworkUploads(client as never, 'p', []), /al menos un archivo/);
  const many = Array.from({ length: COWORK_UPLOAD_MAX_FILES + 1 }, (_, index) => new File(['x'], `f${index}.txt`));
  await assert.rejects(saveCoworkUploads(client as never, 'p', many), /Máximo 8 archivos/);
  await assert.rejects(saveCoworkUploads(client as never, 'p', ['texto']), /Archivo inválido/);
  assert.equal(uploads.length, 0);
});

test('a screenshot or a photo is saved with the type its bytes say; a file only named like an image is refused (COW-11)', async () => {
  const { client, uploads } = storage();
  const saved = await saveCoworkUploads(client as never, 'org-1/user-1/adjuntos', [
    new File([PNG], 'Captura.PNG', { type: 'image/png' }), new File([JPG], 'tarjeta.jpeg', { type: 'application/octet-stream' }),
  ]);
  assert.deepEqual(saved.map(file => file.name), ['captura.png', 'tarjeta.jpeg']);
  assert.deepEqual(uploads.map(upload => upload.contentType), ['image/png', 'image/jpeg']);
  await assert.rejects(saveCoworkUploads(client as never, 'p', [new File(['a,b\n1,2'], 'lista.png', { type: 'image/png' })]), /no es una imagen PNG, JPG o WEBP/);
  assert.equal(uploads.length, 2);
});
