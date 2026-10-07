import createDOMPurify from 'dompurify';
import { SIGNATURE_MAX_HTML } from './signature-builder';

/**
 * «Tu firma actual» in «Firmas y estilo»: the signature a person already uses in Gmail or Outlook, pasted or uploaded as
 * its .htm file, becomes the one the app sends. The same rules as the send-time cleaning (src/lib/server/email-signature.ts)
 * apply here, so the preview is what goes out: text, links, tables and https images; no scripts, forms, handlers or CSS
 * that loads anything. Outlook's own markup (conditional comments, «mso-» styles, classes) is dropped so the signature
 * fits. Images embedded in the signature itself (data:) are handed back to be uploaded; images that live on the person's
 * computer (a relative path or cid:) cannot reach anyone and are counted, so the screen can say so.
 */
export const SIGNATURE_ALLOWED_TAGS = ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'small', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th'];
export const SIGNATURE_ALLOWED_ATTR = ['href', 'src', 'alt', 'width', 'height', 'style', 'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'target', 'rel', 'title'];
export const SIGNATURE_URI = /^(?:https:\/\/|mailto:|tel:)/i;
/** Layout attributes are not addresses: without this, the URL rule would drop «320» or «0». */
export const SIGNATURE_URI_SAFE_ATTR = ['width', 'height', 'align', 'valign', 'cellpadding', 'cellspacing', 'border', 'target', 'rel'];
/** An image embedded in the signature that is uploaded before saving, as the image of the «Imagen» design is. */
export const SIGNATURE_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Where an embedded image goes until it is uploaded: an https address that never resolves, replaced before saving. */
const PENDING = 'https://firma.invalid/pendiente/';

export type ImportedSignature = {
  /** Clean HTML, with `pendingImageUrl(i)` where each embedded image goes. Empty when nothing was found. */
  html: string;
  /** Embedded images (data: URLs) to upload, in the order of their placeholders. */
  embedded: Array<{ dataUrl: string; type: 'image/png' | 'image/jpeg' | 'image/gif' }>;
  /** Images that point to the person's computer (a relative path or cid:), left out. */
  dropped: number;
  /** Longer than the server keeps. */
  tooLong: boolean;
};

export const pendingImageUrl = (index: number) => `${PENDING}${index}`;

/** Declarations that load something or only mean something to Outlook. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:/i;
function cleanStyle(style: string) {
  return style.split(';')
    .map(part => part.trim())
    .filter(part => part && !/^mso-/i.test(part) && !/^(?:tab-stops|text-autospace|font-feature-settings)\s*:/i.test(part))
    .join(';');
}

/**
 * The text of a .htm or .html file. Outlook writes its signatures in the Windows code page and says so in a meta tag;
 * read as UTF-8, «Gerente de Operación» would arrive as «Operaci�n».
 */
export function decodeSignatureFile(bytes: ArrayBuffer) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  const declared = head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() || '';
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (/^(?:windows-1252|iso-8859-1|latin1|cp1252)$/.test(declared)) return new TextDecoder('windows-1252').decode(bytes);
  if (declared === 'utf-8' || declared === 'utf8' || !utf8.includes('�')) return utf8;
  // No charset said and not valid UTF-8: the Windows code page is the usual one.
  return new TextDecoder('windows-1252').decode(bytes);
}

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Pasted plain text (no markup): one line each, with its characters escaped. */
function textToHtml(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd());
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.length ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;">${lines.map(escapeHtml).join('<br>')}</div>` : '';
}

/**
 * The signature, ready to keep, from what was pasted or read from a file. `view` is a browser window (or a jsdom one in
 * the tests): the cleaning needs a DOM.
 */
export function importSignatureHtml(raw: string, view: Window & { DOMParser: typeof DOMParser }): ImportedSignature {
  const input = String(raw || '').trim();
  if (!input) return { html: '', embedded: [], dropped: 0, tooLong: false };
  // Markup only when it has real tags: «Gerente <Ventas>» typed as text is text.
  const markup = /<\/?(?:html|head|body|meta|div|p|br|span|table|tbody|thead|tr|td|th|a|img|b|strong|i|em|u|font|hr|small|o:p)\b/i.test(input) ? input : textToHtml(input);
  const document = new view.DOMParser().parseFromString(markup, 'text/html');
  const embedded: ImportedSignature['embedded'] = [];
  let dropped = 0;
  for (const image of [...document.querySelectorAll('img')]) {
    const src = (image.getAttribute('src') || '').trim();
    const data = src.match(/^data:(image\/(?:png|jpe?g|gif));base64,/i);
    if (data) {
      const type = data[1].toLowerCase().replace('jpg', 'jpeg') as ImportedSignature['embedded'][number]['type'];
      image.setAttribute('src', pendingImageUrl(embedded.length));
      embedded.push({ dataUrl: src, type });
    } else if (/^http:\/\//i.test(src)) {
      // Most email programs block http images; the same address over https usually works.
      image.setAttribute('src', src.replace(/^http:/i, 'https:'));
    } else if (!/^https:\/\//i.test(src)) {
      dropped++;
      image.remove();
    }
  }
  const purify = createDOMPurify(view as unknown as Parameters<typeof createDOMPurify>[0]);
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'style') return;
    if (UNSAFE_STYLE.test(data.attrValue)) { data.keepAttr = false; return; }
    data.attrValue = cleanStyle(data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
  });
  const clean = String(purify.sanitize(document.body.innerHTML, {
    ALLOWED_TAGS: SIGNATURE_ALLOWED_TAGS, ALLOWED_ATTR: SIGNATURE_ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: SIGNATURE_URI, ADD_URI_SAFE_ATTR: SIGNATURE_URI_SAFE_ATTR,
  }))
    // Outlook pads its signatures with empty paragraphs.
    .replace(/(?:<p[^>]*>(?:\s|&nbsp;|<br>)*<\/p>\s*)+$/i, '')
    .replace(/>\s+</g, '> <')
    .trim();
  const probe = new view.DOMParser().parseFromString(clean, 'text/html').body;
  const hasText = Boolean(probe.textContent?.replace(/\s+/g, ' ').trim());
  const html = hasText || probe.querySelector('img[src]') ? clean : '';
  return { html, embedded: html ? embedded : [], dropped, tooLong: html.length > SIGNATURE_MAX_HTML };
}

/** The signature with each embedded image at its uploaded address, and without the ones that could not be uploaded. */
export function placeUploadedImages(html: string, uploaded: Array<string | null>) {
  return html.replace(/<img\b[^>]*?src="https:\/\/firma\.invalid\/pendiente\/(\d+)"[^>]*>/gi, (tag, index: string) => {
    const url = uploaded[Number(index)];
    return url ? tag.replace(pendingImageUrl(Number(index)), url) : '';
  });
}

/** Whether a signature still has an image waiting to be uploaded. */
export const hasPendingImages = (html: string) => html.includes(PENDING);
