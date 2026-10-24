// A received e-mail as «Cargar oportunidad» and the expediente read it (OPP-49): the .eml Gmail downloads and the .msg Outlook saves.
// The message becomes a text document (who wrote it, to whom, when, the subject and the body) and each attachment one more document,
// read like any other: a ZIP as the documents inside it, a message forwarded as an attachment as one more message. What cannot be read
// is named, with what to do. Server-only: the .eml is read with postal-mime, the .msg (an OLE compound file) with SheetJS's CFB reader.
import { coworkHtmlToText } from '@/lib/server/cowork/file-binary';
import { coworkZipGuard } from '@/lib/cowork/zip-guard';
import { DOCUMENT_EXTENSIONS, expandZipUploads, isZip } from '@/lib/commercial-opportunities/zip-uploads';
import { DocumentFileError } from './document-files';

export type MailDocument = { name: string; bytes: Uint8Array };
/** An attachment left out, and why (a sentence): shown to the person as «name»: why. */
export type MailLeft = { name: string; why: string };
type MailFile = MailDocument & { shown?: boolean };
type Mail = { from: string; to: string; date: string; subject: string; body: string; files: MailFile[]; mails: Mail[] };

export const isMailFile = (name: string) => /\.(eml|msg)$/i.test(name);
/** The documents one e-mail brings in besides its message, at most (an expediente holds 40). The rest are named, to upload apart. */
export const MAIL_MAX_DOCUMENTS = 20;
/** And what they weigh together, at most: each one is read while the person waits. */
export const MAIL_MAX_BYTES = 60 * 1024 * 1024;
// A ZIP the mail brings is checked by what it declares before it is opened (zip-guard.ts).
const ZIP_LIMITS = { entries: 500, expandedBytes: MAIL_MAX_BYTES, ratio: 200 };
/** A message forwarded inside a forwarded message is still read; one deeper is named instead. */
const MAIL_DEPTH = 2;

const clean = (name: string) => name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
const extension = (name: string) => (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
// What travels with a message without being a document: its signature, a calendar invitation, a contact card, Outlook's envelope.
const NOT_DOCUMENTS = ['.p7s', '.p7m', '.ics', '.vcs', '.vcf', '.asc', '.sig', '.dat'];
const IMAGE = /\.(jpe?g|png|gif|webp)$/i;
/** A logo, a signature or a social icon: an image the message shows inside its text, or a tiny one. */
const decoration = (file: MailFile) => IMAGE.test(file.name) && (Boolean(file.shown) || file.bytes.length < 16 * 1024);
const whyNot = (name: string) => /\.(tiff?|bmp|heic)$/i.test(name) ? 'Es una imagen en un formato que la IA no lee: guárdala como JPG o PNG y súbela.'
  : /\.(rar|7z|tar|gz|tgz)$/i.test(name) ? 'Es otro comprimido (RAR o 7z): descomprímelo y sube lo que trae.' : 'No es un formato que podamos leer.';
const when = (value: string) => {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).format(at);
};
const readMail = (name: string, bytes: Uint8Array) => (/\.msg$/i.test(name) ? readMsg(bytes) : readEml(bytes));

/** The message as text first («Correo - <asunto>.txt»), then the documents it brings, and what was left out. */
export async function mailDocuments(name: string, bytes: Uint8Array): Promise<{ documents: MailDocument[]; left: MailLeft[] }> {
  const short = name.slice(0, 120);
  let mail: Mail;
  try { mail = await readMail(name, bytes); }
  catch { throw new DocumentFileError(`«${short}» no se pudo abrir como correo. Guárdalo de nuevo desde Gmail u Outlook, o pega el texto.`); }
  const documents: MailDocument[] = [], left: MailLeft[] = [];
  let weight = 0;
  // The message always goes in; what it brings, within the limits.
  const take = (document: MailDocument) => {
    if (documents.length > MAIL_MAX_DOCUMENTS) left.push({ name: document.name, why: `Quedó fuera por el máximo de ${MAIL_MAX_DOCUMENTS} documentos por correo: súbelo aparte.` });
    else if (weight + document.bytes.length > MAIL_MAX_BYTES) left.push({ name: document.name, why: 'Quedó fuera porque el correo trae más de 60 MB en documentos: súbelo aparte.' });
    else { documents.push(document); weight += document.bytes.length; }
  };
  const collect = async (current: Mail, depth: number, fallback: string) => {
    const header = [current.from && `De: ${current.from}`, current.to && `Para: ${current.to}`, current.date && `Fecha: ${current.date}`, current.subject && `Asunto: ${current.subject}`].filter(Boolean).join('\n');
    const text = [header, current.body.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()].filter(Boolean).join('\n\n');
    const title = clean(current.subject || fallback).slice(0, 100) || 'Correo';
    const message = { name: `${depth ? 'Correo adjunto' : 'Correo'} - ${title}.txt`, bytes: new TextEncoder().encode(text) };
    if (depth) take(message); else documents.push(message);
    for (const file of current.files) {
      if (!file.name || NOT_DOCUMENTS.includes(extension(file.name)) || decoration(file)) continue;
      if (isMailFile(file.name)) {
        if (depth + 1 > MAIL_DEPTH) { left.push({ name: file.name, why: 'Es un correo dentro de otro reenviado: ábrelo y súbelo aparte.' }); continue; }
        const inner = await readMail(file.name, file.bytes).catch(() => null);
        if (inner) await collect(inner, depth + 1, file.name.replace(/\.(eml|msg)$/i, ''));
        else left.push({ name: file.name, why: 'No se pudo abrir como correo.' });
      } else if (isZip({ name: file.name, type: '' })) {
        // The bases in a ZIP, as the browser opens one (zip-uploads.ts): its documents, and a ZIP inside it once.
        const guard = coworkZipGuard(file.bytes, ZIP_LIMITS);
        if (!guard.ok) { left.push({ name: file.name, why: `${guard.reason} Descomprímelo y sube lo que trae.` }); continue; }
        const { files, notes } = await expandZipUploads([new File([new Uint8Array(file.bytes)], file.name)]);
        for (const opened of files) take({ name: opened.name, bytes: new Uint8Array(await opened.arrayBuffer()) });
        left.push(...notes.map(note => ({ name: note.name, why: note.message })));
      } else if (DOCUMENT_EXTENSIONS.includes(extension(file.name))) take({ name: file.name, bytes: file.bytes });
      else left.push({ name: file.name, why: whyNot(file.name) });
    }
    for (const inner of current.mails) await collect(inner, depth + 1, 'Correo adjunto');
  };
  await collect(mail, 0, name.replace(/\.(eml|msg)$/i, ''));
  if (!mail.body.trim() && documents.length === 1) {
    throw new DocumentFileError(`«${short}» no trae texto ni adjuntos que leer.${left.map(item => ` «${item.name}»: ${item.why}`).join('')}`);
  }
  return { documents, left };
}

async function readEml(bytes: Uint8Array): Promise<Mail> {
  const { default: PostalMime } = await import('postal-mime');
  const email = await PostalMime.parse(bytes, { maxRfc822NestingDepth: MAIL_DEPTH });
  const who = (value?: { name?: string; address?: string } | null) => (value ? [value.name, value.address && `<${value.address}>`].filter(Boolean).join(' ') : '');
  return {
    from: who(email.from), to: (email.to || []).map(who).filter(Boolean).join(', '), date: email.date ? when(email.date) : '', subject: email.subject || '',
    body: email.text?.trim() ? email.text : coworkHtmlToText(email.html || ''),
    files: email.attachments.map(file => {
      // A message forwarded as an attachment often has no file name.
      const forwarded = file.mimeType === 'message/rfc822';
      const name = clean(file.filename || (forwarded ? 'Correo adjunto' : ''));
      return { name: forwarded && name && !isMailFile(name) ? `${name}.eml` : name, shown: Boolean(file.related) || file.disposition === 'inline',
        bytes: typeof file.content === 'string' ? new TextEncoder().encode(file.content) : new Uint8Array(file.content) };
    }),
    mails: [],
  };
}

/**
 * A .msg keeps each property in a stream named after it: «__substg1.0_0037001F» is the subject (0x0037) as UTF-16 (0x001F; 0x001E is
 * 8-bit text, 0x0102 bytes). The attachments are storages «__attach_version1.0_#…» with their name (0x3707, or 0x3704) and data (0x3701);
 * a message attached as such keeps its own streams one storage down («__substg1.0_3701000D»). Dates are in «__properties_version1.0».
 */
async function readMsg(bytes: Uint8Array): Promise<Mail> {
  const XLSX = await import('xlsx');
  const { CFB } = (XLSX as unknown as { default?: typeof XLSX }).default ?? XLSX;
  const container = CFB.read(Buffer.from(bytes), { type: 'buffer' });
  const streams = new Map<string, Uint8Array>();
  (container.FullPaths as string[]).forEach((path, index) => {
    const entry = container.FileIndex[index];
    if (entry?.type === 2 && entry.content) streams.set(path.replace(/^[^/]*\//, '').toLowerCase(), new Uint8Array(entry.content));
  });
  if (!streams.size) throw new Error('not a message');
  return msgAt(streams, '', 0);
}

function msgAt(streams: Map<string, Uint8Array>, root: string, depth: number): Mail {
  const property = (prop: string, folder = root) => {
    const unicode = streams.get(`${folder}__substg1.0_${prop}001f`);
    if (unicode) return new TextDecoder('utf-16le').decode(unicode).replace(/\u0000+$/, '');
    const ansi = streams.get(`${folder}__substg1.0_${prop}001e`);
    return ansi ? new TextDecoder('windows-1252').decode(ansi).replace(/\u0000+$/, '') : '';
  };
  const html = streams.get(`${root}__substg1.0_10130102`);
  const body = property('1000') || (html ? coworkHtmlToText(new TextDecoder('utf-8').decode(html)) : '');
  const folders = [...new Set([...streams.keys()].filter(path => path.startsWith(root))
    .map(path => path.slice(root.length).match(/^__attach_version1\.0_#[0-9a-f]{8}\//)?.[0]).filter((folder): folder is string => Boolean(folder)))].sort();
  const files: MailFile[] = [], mails: Mail[] = [];
  for (const folder of folders.map(folder => `${root}${folder}`)) {
    const data = streams.get(`${folder}__substg1.0_37010102`);
    const inner = `${folder}__substg1.0_3701000d/`;
    if (data) files.push({ name: clean(property('3707', folder) || property('3704', folder)), bytes: data, shown: Boolean(property('3712', folder)) });
    else if (depth < MAIL_DEPTH && [...streams.keys()].some(path => path.startsWith(inner))) mails.push(msgAt(streams, inner, depth + 1));
  }
  // The sender's address: the SMTP one, or the plain one when it is an address (inside Exchange it is an X.500 path).
  const plain = property('0c1f');
  const sender = property('0c1a'), address = property('5d01') || (plain.includes('@') ? plain : '');
  // When it was sent (PR_CLIENT_SUBMIT_TIME, 0x0039): a FILETIME among the fixed-size properties, after a 32-byte header in the
  // message itself and a 24-byte one in a message attached to it.
  let date = '';
  const fixed = streams.get(`${root}__properties_version1.0`);
  if (fixed) {
    const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength);
    for (let at = root ? 24 : 32; at + 16 <= fixed.byteLength; at += 16) {
      if (view.getUint32(at, true) !== 0x00390040) continue;
      // 100-nanosecond intervals since 1601: as milliseconds, exact enough for a date.
      const ticks = view.getUint32(at + 12, true) * 2 ** 32 + view.getUint32(at + 8, true);
      date = when(new Date(ticks / 10_000 - 11_644_473_600_000).toISOString());
      break;
    }
  }
  return { from: [sender, address && `<${address}>`].filter(Boolean).join(' '), to: property('0e04'), date, subject: property('0037'), body, files, mails };
}
