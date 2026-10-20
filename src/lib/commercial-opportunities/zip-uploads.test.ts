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
  assert.deepEqual(notes, [{ name: 'Licitaciones_20261015195726.zip', message: 'Del ZIP tomamos 3 documentos. «plano.dwg» no es un formato que podamos leer.' }]);
});

test('a ZIP with nothing readable, or that cannot be opened, says so and what to do', async () => {
  const empty = await zipFile({ 'plano.dwg': 'cad' });
  assert.equal((await expandZipUploads([empty], load)).notes[0].message, 'El ZIP no trae bases ni anexos que podamos leer: «plano.dwg» no es un formato que podamos leer.');
  const broken = new File(['no es un zip'], 'roto.zip');
  assert.match((await expandZipUploads([broken], load)).notes[0].message, /No pudimos abrir este ZIP/);
});

test('names written by Windows keep their accents, in Windows-1252 or code page 850, and only .zip files are opened', () => {
  assert.equal(decodeZipName(Uint8Array.from([0x42, 0x61, 0x73, 0x65, 0x73, 0x20, 0x54, 0xe9, 0x63, 0x6e, 0x69, 0x63, 0x61, 0x73, 0x2e, 0x70, 0x64, 0x66])), 'Bases Técnicas.pdf');
  assert.equal(decodeZipName(new TextEncoder().encode('Anexo Nº2 técnico.pdf')), 'Anexo Nº2 técnico.pdf');
  // Windows' own «carpeta comprimida» on a Spanish system: code page 850, as the bases of «ARTELUZA» arrived.
  const cp850 = (text: string) => Uint8Array.from(Array.from(text, char => ({ Ñ: 0xa5, Ó: 0xe0, '°': 0xf8, º: 0xa7, é: 0x82, í: 0xa1, ó: 0xa2, ñ: 0xa4 } as Record<string, number>)[char] ?? char.charCodeAt(0)));
  assert.equal(decodeZipName(cp850('3-DISEÑOS_DE_DIFUSIÓN.pdf')), '3-DISEÑOS_DE_DIFUSIÓN.pdf');
  assert.equal(decodeZipName(cp850('1-RES._EXT._N°1534_APRUEBA_BASES.pdf')), '1-RES._EXT._N°1534_APRUEBA_BASES.pdf');
  assert.equal(decodeZipName(cp850('Anexo técnico y económico.docx')), 'Anexo técnico y económico.docx');
  assert.equal(decodeZipName(cp850('Declaración jurada Nº3.pdf'.replace('Nº', 'N' + 'º'))), 'Declaración jurada Nº3.pdf');
  assert.equal(isZip({ name: 'Licitaciones.ZIP', type: '' }), true);
  assert.equal(isZip({ name: 'Bases.pdf', type: 'application/pdf' }), false);
});

test('LibreOffice, PowerPoint, RTF and the macro versions of Word and Excel go up; a ZIP inside is opened; what stays out is named', async () => {
  const inner = new JSZip(); inner.file('Anexo 7.odt', 'odt'); inner.file('foto.png', 'png');
  const zip = await zipFile({ '1-Bases.pdf': '%PDF', '5-ANEXO_N°4_FORMULARIO.xlsm': 'xlsm', '6-Presentación.pptx': 'pptx', '7-Carta.rtf': '{\\rtf1}',
    '8-Anexos.zip': await inner.generateAsync({ type: 'uint8array' }), '9-PLANO_OFICINAS.jpg': 'jpg', '10-Respaldo.rar': 'rar' });
  const { files, notes } = await expandZipUploads([zip], load);
  assert.deepEqual(files.map(f => f.name).sort(), ['1-Bases.pdf', '5-ANEXO_N°4_FORMULARIO.xlsm', '6-Presentación.pptx', '7-Carta.rtf', 'Anexo 7.odt']);
  assert.equal(notes[0].message, 'Del ZIP tomamos 5 documentos. «foto.png» y «9-PLANO_OFICINAS.jpg» son imágenes: la IA lee texto, ábrelas en Mercado Público; «10-Respaldo.rar» es otro comprimido (RAR o 7z): descomprímelo y sube lo que trae.');
});
