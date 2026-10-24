import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { MAIL_MAX_DOCUMENTS, isMailFile, mailDocuments } from './mail-files';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
// A photo the size of a real one: a logo or an icon weighs less.
const photo = Buffer.alloc(40 * 1024, 7);
const base64 = (bytes: Buffer | Uint8Array) => Buffer.from(bytes).toString('base64');
const part = (headers: string[], body: string) => [...headers, '', body];

async function zip(files: Record<string, Buffer>) {
  const archive = new JSZip();
  for (const [name, bytes] of Object.entries(files)) archive.file(name, bytes);
  return Buffer.from(await archive.generateAsync({ type: 'uint8array' }));
}

// The message a buyer forwards «as an attachment»: it brings its own attachment.
const forwarded = [
  'From: Licitaciones <licitaciones@hospitalcastro.cl>',
  'Subject: Bases y anexos',
  'Content-Type: multipart/mixed; boundary="fwd"',
  '',
  '--fwd',
  ...part(['Content-Type: text/plain; charset=utf-8'], 'Van las bases técnicas.'),
  '--fwd',
  ...part(['Content-Type: application/pdf; name="Bases técnicas.pdf"', 'Content-Disposition: attachment; filename="Bases técnicas.pdf"', 'Content-Transfer-Encoding: base64'], base64(pdf)),
  '--fwd--',
  '',
].join('\r\n');

// What Gmail downloads («Descargar mensaje»): headers in their encoded words, the text, the HTML, a logo drawn in the message, the
// bases, a ZIP of annexes, a RAR, the calendar invitation, the signature and the message forwarded as an attachment.
async function eml() {
  const annexes = await zip({ 'Anexo 1 Formulario.pdf': pdf, 'plano.dwg': Buffer.from('dwg') });
  return [
    'From: =?UTF-8?Q?Mar=C3=ADa_Paz_Rojas?= <compras@hospitalcastro.cl>',
    'To: ventas@aseosur.cl',
    'Subject: =?UTF-8?Q?Invitaci=C3=B3n_a_cotizar:_aseo_hospitalario?=',
    'Date: Thu, 22 Oct 2026 10:15:00 -0300',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mix"',
    '',
    '--mix',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    ...part(['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'], 'Estimados: los invitamos a cotizar el servicio de aseo. Cierre: 30 de octubre a las 15:00. Presupuesto: $45.000.000.'),
    '--alt',
    ...part(['Content-Type: text/html; charset=utf-8'], '<p>Estimados: los invitamos a cotizar el servicio de aseo.</p><img src="cid:logo">'),
    '--alt--',
    '--mix',
    ...part(['Content-Type: image/png', 'Content-Disposition: inline', 'Content-ID: <logo>', 'Content-Transfer-Encoding: base64'], base64(photo)),
    '--mix',
    ...part(['Content-Type: application/pdf; name="Bases aseo.pdf"', 'Content-Disposition: attachment; filename="Bases aseo.pdf"', 'Content-Transfer-Encoding: base64'], base64(pdf)),
    '--mix',
    ...part(['Content-Type: application/zip; name="Anexos.zip"', 'Content-Disposition: attachment; filename="Anexos.zip"', 'Content-Transfer-Encoding: base64'], base64(annexes)),
    '--mix',
    ...part(['Content-Type: application/x-rar-compressed; name="Planos.rar"', 'Content-Disposition: attachment; filename="Planos.rar"', 'Content-Transfer-Encoding: base64'], base64(Buffer.from('rar'))),
    '--mix',
    ...part(['Content-Type: text/calendar; method=REQUEST; name="invite.ics"', 'Content-Disposition: attachment; filename="invite.ics"'], 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'),
    '--mix',
    ...part(['Content-Type: image/png; name="linkedin.png"', 'Content-Disposition: attachment; filename="linkedin.png"', 'Content-Transfer-Encoding: base64'], base64(Buffer.from('icon'))),
    '--mix',
    ...part(['Content-Type: message/rfc822', 'Content-Disposition: attachment'], forwarded),
    '--mix--',
    '',
  ].join('\r\n');
}

test('a .eml becomes the message as text and the documents it brings; what is not a document stays out, and what cannot be read is named', async () => {
  assert.equal(isMailFile('Invitación.eml'), true);
  assert.equal(isMailFile('Invitación.MSG'), true);
  assert.equal(isMailFile('Bases.pdf'), false);
  const { documents, left } = await mailDocuments('Invitación.eml', new TextEncoder().encode(await eml()));
  assert.deepEqual(documents.map(item => item.name), ['Correo - Invitación a cotizar aseo hospitalario.txt', 'Bases aseo.pdf', 'Anexo 1 Formulario.pdf',
    'Correo adjunto - Bases y anexos.txt', 'Bases técnicas.pdf']);
  const text = decode(documents[0].bytes);
  assert.match(text, /^De: María Paz Rojas <compras@hospitalcastro\.cl>\nPara: <?ventas@aseosur\.cl>?\nFecha: 22 de octubre de 2026 a las 10:15\nAsunto: Invitación a cotizar: aseo hospitalario\n\nEstimados: los invitamos a cotizar el servicio de aseo\. Cierre: 30 de octubre a las 15:00\. Presupuesto: \$45\.000\.000\./);
  assert.deepEqual(Buffer.from(documents[1].bytes), pdf);
  assert.deepEqual(Buffer.from(documents[2].bytes), pdf);
  assert.match(decode(documents[3].bytes), /^De: Licitaciones <licitaciones@hospitalcastro\.cl>\nAsunto: Bases y anexos\n\nVan las bases técnicas\.$/);
  assert.deepEqual(left, [
    { name: 'Anexos.zip', why: 'Del ZIP tomamos 1 documento. «plano.dwg» no es un formato que podamos leer.' },
    { name: 'Planos.rar', why: 'Es otro comprimido (RAR o 7z): descomprímelo y sube lo que trae.' },
  ]);
});

test('a message with HTML only is read from its HTML', async () => {
  const html = ['From: compras@muni.cl', 'Subject: Cotización', 'Content-Type: text/html; charset=utf-8', '', '<html><body><h1>Cotización de guardias</h1><p>Plazo: 5 días.</p></body></html>', ''].join('\r\n');
  const { documents: [message] } = await mailDocuments('cotizacion.eml', new TextEncoder().encode(html));
  assert.match(decode(message.bytes), /Cotización de guardias[\s\S]*Plazo: 5 días\./);
});

// What Outlook saves («Guardar como»): an OLE compound file with one stream per property, and a storage per attachment.
type MsgInput = { subject: string; body: string; sender?: string; address?: string; sent?: Date; attachments?: Array<{ name: string; bytes: Uint8Array; contentId?: string } | { message: MsgInput }> };
function msg(input: MsgInput) {
  const utf16 = (text: string) => Buffer.from(`${text}\u0000`, 'utf16le');
  const cfb = XLSX.CFB.utils.cfb_new();
  const write = (root: string, item: MsgInput, header: number) => {
    XLSX.CFB.utils.cfb_add(cfb, `${root}__substg1.0_0037001F`, utf16(item.subject));
    XLSX.CFB.utils.cfb_add(cfb, `${root}__substg1.0_1000001F`, utf16(item.body));
    if (item.sender) XLSX.CFB.utils.cfb_add(cfb, `${root}__substg1.0_0C1A001F`, utf16(item.sender));
    if (item.address) XLSX.CFB.utils.cfb_add(cfb, `${root}__substg1.0_5D01001F`, utf16(item.address));
    if (item.sent) {
      // PR_CLIENT_SUBMIT_TIME as a FILETIME, after the header of the fixed-size properties.
      const fixed = Buffer.alloc(header + 16);
      fixed.writeUInt32LE(0x00390040, header);
      fixed.writeBigUInt64LE(BigInt(item.sent.getTime() + 11_644_473_600_000) * BigInt(10_000), header + 8);
      XLSX.CFB.utils.cfb_add(cfb, `${root}__properties_version1.0`, fixed);
    }
    (item.attachments || []).forEach((attachment, index) => {
      const folder = `${root}__attach_version1.0_#${index.toString(16).toUpperCase().padStart(8, '0')}/`;
      if ('message' in attachment) { write(`${folder}__substg1.0_3701000D/`, attachment.message, 24); return; }
      XLSX.CFB.utils.cfb_add(cfb, `${folder}__substg1.0_3707001F`, utf16(attachment.name));
      XLSX.CFB.utils.cfb_add(cfb, `${folder}__substg1.0_37010102`, Buffer.from(attachment.bytes));
      if (attachment.contentId) XLSX.CFB.utils.cfb_add(cfb, `${folder}__substg1.0_3712001F`, utf16(attachment.contentId));
    });
  };
  write('/', input, 32);
  return new Uint8Array(XLSX.CFB.write(cfb, { type: 'buffer' }) as Buffer);
}

test('a .msg from Outlook becomes the message, when it was sent, its attachments and the message forwarded inside it', async () => {
  const { documents, left } = await mailDocuments('Invitación.msg', msg({ subject: 'Invitación: guardias para 12 sucursales', body: 'Adjuntamos las bases. Consultas hasta el 28 de octubre.',
    sender: 'Juan Pérez', address: 'jperez@retail.cl', sent: new Date('2026-10-21T14:30:00Z'), attachments: [
      { name: 'Bases técnicas.pdf', bytes: pdf },
      { name: 'image001.png', bytes: photo, contentId: 'image001.png@01DA' },
      { message: { subject: 'RV: Presupuesto', body: 'El presupuesto es de 80 millones.', sent: new Date('2026-10-20T12:00:00Z') } },
    ] }));
  assert.deepEqual(documents.map(item => item.name), ['Correo - Invitación guardias para 12 sucursales.txt', 'Bases técnicas.pdf', 'Correo adjunto - RV Presupuesto.txt']);
  assert.equal(decode(documents[0].bytes), 'De: Juan Pérez <jperez@retail.cl>\nFecha: 21 de octubre de 2026 a las 11:30\nAsunto: Invitación: guardias para 12 sucursales\n\nAdjuntamos las bases. Consultas hasta el 28 de octubre.');
  assert.deepEqual(Buffer.from(documents[1].bytes), pdf);
  assert.equal(decode(documents[2].bytes), 'Fecha: 20 de octubre de 2026 a las 09:00\nAsunto: RV: Presupuesto\n\nEl presupuesto es de 80 millones.');
  assert.deepEqual(left, []);
});

test('an e-mail with more documents than one takes names the rest', async () => {
  const many = Array.from({ length: MAIL_MAX_DOCUMENTS + 2 }, (_, index) => ({ name: `Anexo ${index + 1}.pdf`, bytes: pdf }));
  const { documents, left } = await mailDocuments('Anexos.msg', msg({ subject: 'Anexos', body: 'Los anexos.', attachments: many }));
  assert.equal(documents.length, MAIL_MAX_DOCUMENTS + 1);
  assert.deepEqual(left.map(item => item.name), [`Anexo ${MAIL_MAX_DOCUMENTS + 1}.pdf`, `Anexo ${MAIL_MAX_DOCUMENTS + 2}.pdf`]);
  assert.equal(left[0].why, 'Quedó fuera por el máximo de 20 documentos por correo: súbelo aparte.');
});

test('a ZIP that declares more than an e-mail brings is not opened', async () => {
  // A ZIP that says it holds 64 MB: only its directory is read (zip-guard.ts).
  const archive = await zip({ 'Bases.pdf': pdf });
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const entry = archive.readUInt32LE(end + 16);
  archive.writeUInt32LE(64 * 1024 * 1024, entry + 24);
  const { documents, left } = await mailDocuments('Bases.msg', msg({ subject: 'Bases', body: 'Las bases.', attachments: [{ name: 'Bases.zip', bytes: archive }] }));
  assert.deepEqual(documents.map(item => item.name), ['Correo - Bases.txt']);
  assert.deepEqual(left, [{ name: 'Bases.zip', why: 'El archivo es demasiado grande al abrirlo. Descomprímelo y sube lo que trae.' }]);
});

test('a file that is not a mail, or a mail with nothing to read, says what to do', async () => {
  await assert.rejects(mailDocuments('roto.msg', new Uint8Array([1, 2, 3])), /no se pudo abrir como correo\. Guárdalo de nuevo desde Gmail u Outlook, o pega el texto/);
  await assert.rejects(mailDocuments('vacio.eml', new TextEncoder().encode('Subject: Nada\r\n\r\n')), /no trae texto ni adjuntos que leer/);
  const rarOnly = ['Subject: Planos', 'Content-Type: multipart/mixed; boundary="b"', '', '--b',
    ...part(['Content-Type: application/x-rar-compressed; name="Planos.rar"', 'Content-Disposition: attachment; filename="Planos.rar"', 'Content-Transfer-Encoding: base64'], base64(Buffer.from('rar'))), '--b--', ''].join('\r\n');
  await assert.rejects(mailDocuments('planos.eml', new TextEncoder().encode(rarOnly)), /«planos\.eml» no trae texto ni adjuntos que leer\. «Planos\.rar»: Es otro comprimido \(RAR o 7z\): descomprímelo y sube lo que trae\.$/);
});
