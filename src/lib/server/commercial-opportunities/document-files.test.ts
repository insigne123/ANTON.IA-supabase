import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityLegacyAsText, opportunityStorageName } from './document-files';

test('storage keys drop accents, «ñ» and «°» that Supabase Storage refuses, keeping the extension', () => {
  assert.equal(opportunityStorageName('Bases Técnicas N°2.pdf'), 'Bases Tecnicas N_2.pdf');
  assert.equal(opportunityStorageName('Preguntas y respuestas públicas.txt'), 'Preguntas y respuestas publicas.txt');
  assert.equal(opportunityStorageName('FORMULARIO N°4 OFERTA ECONÓMICA.DOCX'), 'FORMULARIO N_4 OFERTA ECONOMICA.docx');
  assert.equal(opportunityStorageName('Año 2026: anexo «final».xlsx'), 'Ano 2026_ anexo _final_.xlsx');
  assert.match(opportunityStorageName('日本語.pdf'), /^[A-Za-z0-9._ -]+$/);
  assert.ok(opportunityStorageName(`${'a'.repeat(400)}.pdf`).length <= 154);
});

test('Excel 97-2003 forms are read as text; anything that is not an OLE file is refused with a clear reason', async () => {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Ítem', 'Precio UF'], ['Consulta PJUD', 0.12]]), 'Oferta');
  const xls = new Uint8Array(XLSX.write(book, { bookType: 'biff8', type: 'buffer' }));
  const converted = await opportunityLegacyAsText('FORMULARIO N°4 OFERTA ECONÓMICA.xls', xls);
  assert.equal(converted!.name, 'FORMULARIO N°4 OFERTA ECONÓMICA (texto del Excel).txt');
  assert.match(new TextDecoder().decode(converted!.bytes), /Hoja Oferta\nÍtem \| Precio UF\nConsulta PJUD \| 0\.12/);
  await assert.rejects(opportunityLegacyAsText('Formulario.doc', new TextEncoder().encode('<html>no es Word</html>')), /no es un archivo de Word o Excel válido/);
  assert.equal(await opportunityLegacyAsText('Bases.pdf', new Uint8Array([37, 80, 68, 70])), null);
});
