import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_UPLOAD_MAX_FILES, CoworkUploadRejected, coworkUploadName, saveCoworkUploads } from './upload-files';

function storage() {
  const uploads: Array<{ bucket: string; path: string; size: number }> = [];
  const client = { storage: { from: (bucket: string) => ({
    upload: async (path: string, bytes: Buffer) => { uploads.push({ bucket, path, size: bytes.length }); return { data: { path }, error: null }; },
  }) } };
  return { client, uploads };
}

test('uploads are saved lower-cased under the prefix, with their sizes', async () => {
  const { client, uploads } = storage();
  const saved = await saveCoworkUploads(client as never, 'org-1/user-1/adjuntos', [new File(['a,b\n1,2'], 'Leads-Feria.CSV', { type: 'text/csv' })]);
  assert.deepEqual(saved, [{ name: 'leads-feria.csv', size: 7 }]);
  assert.deepEqual(uploads, [{ bucket: 'cowork-uploads', path: 'org-1/user-1/adjuntos/leads-feria.csv', size: 7 }]);
});

test('unsafe names, other kinds, empty files and too many files are refused before saving', async () => {
  for (const name of ['../x.csv', 'a/b.csv', '.env', 'foto.png', 'sin-extension', 'linea\nnueva.csv']) {
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
