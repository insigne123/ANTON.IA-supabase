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

test('LibreOffice, PowerPoint, RTF and the macro and template versions of Word and Excel are kept as the text they hold', async () => {
  const { default: JSZip } = await import('jszip');
  const XLSX = await import('xlsx');
  const zipOf = async (files: Record<string, string>) => { const zip = new JSZip(); for (const [path, body] of Object.entries(files)) zip.file(path, body); return zip.generateAsync({ type: 'uint8array' }); };
  const text = (converted: { bytes: Uint8Array } | null) => new TextDecoder().decode(converted!.bytes);

  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Puesto', 'Turnos'], ['Guardia diurno', 2]]), 'Formulario');
  const xlsm = await opportunityLegacyAsText('5-ANEXO_N°4_FORMULARIO.xlsm', new Uint8Array(XLSX.write(book, { bookType: 'xlsm', type: 'buffer' })));
  assert.equal(xlsm!.name, '5-ANEXO_N°4_FORMULARIO (texto del Excel).txt');
  assert.match(text(xlsm), /Hoja Formulario\nPuesto \| Turnos\nGuardia diurno \| 2/);
  const ods = await opportunityLegacyAsText('Planilla.ods', new Uint8Array(XLSX.write(book, { bookType: 'ods', type: 'buffer' })));
  assert.equal(ods!.name, 'Planilla (texto de la planilla).txt');
  assert.match(text(ods), /Guardia diurno \| 2/);

  const odt = await opportunityLegacyAsText('Anexo técnico.odt', await zipOf({ 'mimetype': 'application/vnd.oasis.opendocument.text',
    'content.xml': '<office:document-content><office:body><office:text><text:h>Requisitos</text:h><text:p>Guardias con OS-10<text:tab/>vigente</text:p><text:p>Turnos 4x4 &amp; relevo</text:p></office:text></office:body></office:document-content>' }));
  assert.equal(odt!.name, 'Anexo técnico (texto del documento).txt');
  assert.equal(text(odt), 'Requisitos\nGuardias con OS-10\tvigente\nTurnos 4x4 & relevo');

  const pptx = await opportunityLegacyAsText('Charla.pptx', await zipOf({
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Turnos y relevos</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Servicio de </a:t></a:r><a:r><a:t>guardias</a:t></a:r></a:p><a:p><a:r><a:t>DRT Valparaíso</a:t></a:r></a:p></p:sld>' }));
  assert.equal(pptx!.name, 'Charla (texto de la presentación).txt');
  assert.equal(text(pptx), 'Diapositiva 1\nServicio de guardias\nDRT Valparaíso\n\nDiapositiva 2\nTurnos y relevos');

  const rtf = await opportunityLegacyAsText('Carta.rtf', new TextEncoder().encode('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator Word;}\\f0 Oferta t\\\'e9cnica\\par Monto: 1.200 UF\\tab IVA inclu\\u237?do}'));
  assert.equal(text(rtf), 'Oferta técnica\nMonto: 1.200 UF\tIVA incluído');

  const docm = await opportunityLegacyAsText('Anexo N°2.docm', await zipOf({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Oferta económica</w:t></w:r></w:p></w:body></w:document>' }));
  assert.equal(docm!.name, 'Anexo N°2 (texto del Word).txt');
  assert.match(text(docm), /Oferta económica/);

  await assert.rejects(opportunityLegacyAsText('Roto.pptx', new TextEncoder().encode('no es un zip')), /Roto\.pptx/);
  assert.equal(await opportunityLegacyAsText('Plano.jpg', new Uint8Array([0xff, 0xd8])), null, 'an image is not read as text');
});
