/**
 * The signature builder of «Firmas y estilo» (Plan 11, PR 3b): a few fields and a design become the HTML and text the
 * server adds to every email (PR 3a). Pure and email-safe: tables and inline styles that Gmail and Outlook render, every
 * value escaped, links only https, mailto or tel, and images only over https. The fields are kept with the signature
 * so it can be edited again instead of starting over.
 */
/** What the server keeps of a signature when it sends it (src/lib/server/email-signature.ts). */
export const SIGNATURE_MAX_HTML = 20_000;

export type SignatureDesign = 'propia' | 'clasica' | 'con-logo' | 'compacta' | 'imagen';

export type SignatureFields = {
  name: string;
  title: string;
  company: string;
  phone: string;
  website: string;
  linkedin: string;
  /** A logo or a photo (with-logo design), or the whole signature as an image (image design). https only. */
  imageUrl: string;
  imageWidth: number;
  /** The signature the person already uses, pasted or read from its file and already cleaned (signature-import.ts). */
  customHtml: string;
};

export const SIGNATURE_DESIGNS: Array<{ id: SignatureDesign; label: string; description: string }> = [
  { id: 'propia', label: 'Tu firma actual', description: 'Pega la que ya usas en Gmail u Outlook, o sube su archivo.' },
  { id: 'clasica', label: 'Clásica', description: 'Tu nombre y tus datos, uno por línea.' },
  { id: 'con-logo', label: 'Con logo', description: 'Logo o foto a la izquierda y tus datos al lado.' },
  { id: 'compacta', label: 'Compacta', description: 'Todo en dos líneas, para correos breves.' },
  { id: 'imagen', label: 'Imagen', description: 'Una imagen de firma que ya tengas.' },
];

export const EMPTY_SIGNATURE_FIELDS: SignatureFields = {
  name: '', title: '', company: '', phone: '', website: '', linkedin: '', imageUrl: '', imageWidth: 320, customHtml: '',
};

const INK = '#1f2937';
const MUTED = '#6b7280';
const LINK = '#2563eb';
const FONT = 'font-family:Arial,Helvetica,sans-serif;';

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clean = (value: unknown, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** An https address, or nothing: «empresa.cl» becomes «https://empresa.cl». */
export function safeHttpsUrl(value: unknown) {
  const raw = clean(value, 500);
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw.replace(/^http:/i, 'https:') : `https://${raw.replace(/^\/+/, '')}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname.includes('.') && !/[\s"'<>]/.test(candidate) ? url.toString() : '';
  } catch {
    return '';
  }
}

const displayUrl = (url: string) => url.replace(/^https:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
const telHref = (phone: string) => phone.replace(/[^\d+]/g, '');

function normalize(fields: Partial<SignatureFields>): SignatureFields {
  const width = Math.round(Number(fields.imageWidth) || EMPTY_SIGNATURE_FIELDS.imageWidth);
  return {
    name: clean(fields.name, 120),
    title: clean(fields.title, 120),
    company: clean(fields.company, 120),
    phone: clean(fields.phone, 40),
    website: safeHttpsUrl(fields.website),
    linkedin: /linkedin\.com\//i.test(String(fields.linkedin || '')) ? safeHttpsUrl(fields.linkedin) : '',
    imageUrl: safeHttpsUrl(fields.imageUrl),
    imageWidth: Math.min(600, Math.max(48, width)),
    // Cleaned when it was imported, and again by the server when it sends: kept whole here, never cut mid-tag.
    customHtml: typeof fields.customHtml === 'string' ? fields.customHtml.trim() : '',
  };
}

/** The contact line: phone, website and LinkedIn, each a link. */
function contactLinks(fields: SignatureFields) {
  const links: string[] = [];
  if (fields.phone && telHref(fields.phone)) {
    links.push(`<a href="tel:${escapeHtml(telHref(fields.phone))}" style="color:${LINK};text-decoration:none;">${escapeHtml(fields.phone)}</a>`);
  }
  if (fields.website) links.push(`<a href="${escapeHtml(fields.website)}" style="color:${LINK};text-decoration:none;">${escapeHtml(displayUrl(fields.website))}</a>`);
  if (fields.linkedin) links.push(`<a href="${escapeHtml(fields.linkedin)}" style="color:${LINK};text-decoration:none;">LinkedIn</a>`);
  return links;
}

const roleLine = (fields: SignatureFields) => [fields.title, fields.company].filter(Boolean).map(escapeHtml).join(' · ');

/** The HTML of the signature for one design; empty when there is nothing to sign with. */
export function buildSignatureHtml(input: Partial<SignatureFields>, design: SignatureDesign) {
  const fields = normalize(input);
  if (design === 'propia') return fields.customHtml;
  if (design === 'imagen') {
    return fields.imageUrl
      ? `<table cellpadding="0" cellspacing="0" border="0"><tr><td><img src="${escapeHtml(fields.imageUrl)}" alt="${escapeHtml(fields.name || 'Firma')}" width="${fields.imageWidth}" style="display:block;max-width:100%;height:auto;border:0;"></td></tr></table>`
      : '';
  }
  if (!fields.name && !fields.title && !fields.company && contactLinks(fields).length === 0) return '';
  const links = contactLinks(fields).join(`<span style="color:${MUTED};"> · </span>`);
  const name = fields.name ? `<strong style="color:${INK};font-size:14px;">${escapeHtml(fields.name)}</strong>` : '';
  const role = roleLine(fields);

  if (design === 'compacta') {
    const first = [name, role ? `<span style="color:${MUTED};">${role}</span>` : ''].filter(Boolean).join(`<span style="color:${MUTED};"> · </span>`);
    return `<table cellpadding="0" cellspacing="0" border="0" style="${FONT}font-size:13px;line-height:18px;color:${INK};">`
      + (first ? `<tr><td>${first}</td></tr>` : '')
      + (links ? `<tr><td style="padding-top:2px;">${links}</td></tr>` : '')
      + '</table>';
  }

  const details = [
    name ? `<tr><td style="padding-bottom:2px;">${name}</td></tr>` : '',
    role ? `<tr><td style="color:${MUTED};padding-bottom:4px;">${role}</td></tr>` : '',
    links ? `<tr><td>${links}</td></tr>` : '',
  ].join('');
  const block = `<table cellpadding="0" cellspacing="0" border="0" style="${FONT}font-size:13px;line-height:19px;color:${INK};">${details}</table>`;
  if (design === 'con-logo' && fields.imageUrl) {
    const width = Math.min(fields.imageWidth, 96);
    return `<table cellpadding="0" cellspacing="0" border="0"><tr>`
      + `<td valign="top" style="padding-right:12px;"><img src="${escapeHtml(fields.imageUrl)}" alt="${escapeHtml(fields.company || fields.name || 'Logo')}" width="${width}" style="display:block;max-width:${width}px;height:auto;border:0;"></td>`
      + `<td valign="top" style="border-left:2px solid #e5e7eb;padding-left:12px;">${block}</td></tr></table>`;
  }
  return block;
}

/** The plain-text version: the same data, one item per line. */
export function buildSignatureText(input: Partial<SignatureFields>, design: SignatureDesign) {
  const fields = normalize(input);
  // The server reads the text out of the signature itself when it sends.
  if (design === 'propia') return '';
  if (design === 'imagen') return fields.name;
  const role = [fields.title, fields.company].filter(Boolean).join(' · ');
  const contact = [fields.phone, fields.website ? displayUrl(fields.website) : '', fields.linkedin].filter(Boolean);
  if (design === 'compacta') return [[fields.name, role].filter(Boolean).join(' · '), contact.join(' · ')].filter(Boolean).join('\n');
  return [fields.name, role, ...contact].filter(Boolean).join('\n');
}

/** What can be signed with: the image design needs an image, the others a name or a way to reach the person. */
export function signatureProblem(input: Partial<SignatureFields>, design: SignatureDesign) {
  const fields = normalize(input);
  if (design === 'propia') {
    if (!fields.customHtml) return 'Pega tu firma o sube su archivo.';
    if (fields.customHtml.length > SIGNATURE_MAX_HTML) return 'Tu firma es demasiado larga para enviarla. Pega una versión más simple o usa otro diseño.';
    return null;
  }
  if (design === 'imagen') return fields.imageUrl ? null : 'Sube la imagen de tu firma.';
  if (design === 'con-logo' && !fields.imageUrl) return 'Sube tu logo o foto, o elige otro diseño.';
  if (!fields.name) return 'Escribe tu nombre.';
  if (input.website && !fields.website) return 'Revisa tu sitio web: debe ser una dirección válida.';
  if (input.linkedin && !fields.linkedin) return 'Revisa tu LinkedIn: pega la dirección de tu perfil.';
  return null;
}
