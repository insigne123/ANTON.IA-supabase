import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { decodeZipName, expandZipUploads, isZip } from './zip-uploads';

const zipFile = async (entries: Record<string, string | Uint8Array>, name = 'Licitaciones_20261015195726.zip') => {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return new File([await zip.generateAsync({ type: 'uint8array' })], name, { type: 'application/x-zip-compressed' });
};
const load = (data: ArrayBuffer) => JSZip.loadAsync(data, { decodeFileName: decodeZipName as never }) as never;

test('the ZIP that Mercado Público downloads goes up as the documents inside it', async () => {
  const zip = await zipFile({ 'Anexos/Bases Administrativas.pdf': '%PDF-1.4', 'Anexos/Anexo N°1.docx': 'word', 'Planilla.xlsx': 'excel',
    '__MACOSX/._Planilla.xlsx': 'meta', 'Anexos/plano.dwg': 'cad', 'Anexos/': '' });
  const { files, notes } = await expandZipUploads([zip, new File(['%PDF'], 'Aclaraciones.pdf')], load);
  assert.deepEqual(files.map(f => f.name).sort(), ['Aclaraciones.pdf', 'Anexo N°1.docx', 'Bases Administrativas.pdf', 'Planilla.xlsx']);
  assert.deepEqual(notes, [{ name: 'Licitaciones_20261015195726.zip', message: 'Subimos 3 documentos del ZIP; 1 archivo no es PDF, Word, Excel ni texto.' }]);
});

test('a ZIP with nothing readable, or that cannot be opened, says so and what to do', async () => {
  const empty = await zipFile({ 'plano.dwg': 'cad' });
  assert.match((await expandZipUploads([empty], load)).notes[0].message, /no trae bases ni anexos que podamos leer \(1 archivo no es/);
  const broken = new File(['no es un zip'], 'roto.zip');
  assert.match((await expandZipUploads([broken], load)).notes[0].message, /No pudimos abrir este ZIP/);
});

test('names written by Windows (Windows-1252) keep their accents, and only .zip files are opened', () => {
  assert.equal(decodeZipName(Uint8Array.from([0x42, 0x61, 0x73, 0x65, 0x73, 0x20, 0x54, 0xe9, 0x63, 0x6e, 0x69, 0x63, 0x61, 0x73, 0x2e, 0x70, 0x64, 0x66])), 'Bases Técnicas.pdf');
  assert.equal(decodeZipName(new TextEncoder().encode('Anexo Nº2 técnico.pdf')), 'Anexo Nº2 técnico.pdf');
  assert.equal(isZip({ name: 'Licitaciones.ZIP', type: '' }), true);
  assert.equal(isZip({ name: 'Bases.pdf', type: 'application/pdf' }), false);
});
