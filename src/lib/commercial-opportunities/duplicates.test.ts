import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { duplicateNotice, duplicateQuerySchema, fileFingerprint, type DuplicateMatch } from './duplicates';

const match = (extra: Partial<DuplicateMatch> = {}): DuplicateMatch => ({ id: 'op-1', title: 'Servicio de administración y operación de Oficinas de Atención de Clientes 2027',
  createdAt: '2026-10-22T19:04:04Z', matched: 7, readable: true, ...extra });

test('a file\'s fingerprint is the one the server keeps: SHA-256 of its bytes, in hexadecimal', async () => {
  const bytes = Buffer.from('Bases Técnicas Servicio Oficinas de Atención de Clientes 2027');
  assert.equal(await fileFingerprint(new Blob([bytes])), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(duplicateQuerySchema.parse({ hashes: [createHash('sha256').update('a').digest('hex').toUpperCase()] }).hashes,
    [createHash('sha256').update('a').digest('hex')], 'read in lowercase');
  assert.throws(() => duplicateQuerySchema.parse({ hashes: ['no-es-un-hash'] }));
});

test('the same bases loaded again say where they are, with the opportunity to open instead (the four ESVAL copies of October)', () => {
  const all = duplicateNotice([match()], 7)!;
  assert.equal(all.text, 'Estos documentos ya están en «Servicio de administración y operación de Oficinas de Atención de Clientes 2027», cargada el 22 de octubre. Ábrela en vez de cargarla de nuevo: así no se repite el informe.');
  assert.equal(all.open?.id, 'op-1');
  // Some of the files, one file, and the opportunity with most of them first.
  assert.match(duplicateNotice([match({ id: 'a', matched: 2 }), match({ id: 'b', matched: 5, createdAt: '2026-10-28T15:39:00Z' })], 8)!.text, /^5 de los 8 documentos ya están en .*, cargada el 28 de octubre\. .* También aparecen en otra oportunidad\.$/);
  assert.match(duplicateNotice([match({ matched: 1 })], 1)!.text, /^Este documento ya está en «/);
  assert.equal(duplicateNotice([], 3), null);
  assert.equal(duplicateNotice([match()], 0), null);
});

test('one the person cannot open is told without its title, and they ask an administrator for it', () => {
  const hidden = duplicateNotice([match({ title: null, readable: false })], 7)!;
  assert.equal(hidden.text, 'Estos documentos ya están en una oportunidad que tu equipo cargó el 22 de octubre. Pídele acceso a un administrador antes de cargarla de nuevo.');
  assert.equal(hidden.open, null);
});
