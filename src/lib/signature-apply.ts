// Helpers para aplicar la firma a un email (HTML + Texto)
import { SignatureConfig } from './email-signature-storage';

function stripHtmlToText(html: string): string {
  // Conversión simple a texto (sin dependencias pesadas)
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @deprecated Usa applySignatureV2 para lógica de `img` más robusta.
 */
export function applySignature({
  html,
  text,
  signature,
}: {
  html?: string;
  text?: string;
  signature: SignatureConfig | null;
}): { html?: string; text?: string } {
  if (!signature || !signature.enabled) {
    return { html, text };
  }

  const sigHtml = signature.html?.trim();
  const sigTextRaw =
    signature.text?.trim() || (sigHtml ? stripHtmlToText(sigHtml) : '');
  const sep = signature.separatorPlaintext !== false ? '-- ' : '';

  const outHtml = html ? `${html}\n\n${sigHtml}` : sigHtml || html;
  const outText = text
    ? `${text}\n\n${sep}${sigTextRaw}`
    : `${sep}${sigTextRaw}`;

  return { html: outHtml, text: outText };
}


/**
 * Aplica firma a HTML garantizando que `<img>` tenga URL absoluta HTTPS.
 * @param bodyHtml Cuerpo del correo.
 * @param signatureHtml Firma a aplicar.
 * @returns El cuerpo del correo con la firma adjunta.
 */
export function applySignatureHTML(bodyHtml: string, signatureHtml?: string): string {
  if (!signatureHtml) return bodyHtml;

  const ABSOLUTE_HTTPS = /^https:\/\/.+/i;
  // Revisa cada <img> en la firma
  const safeSignatureHtml = signatureHtml.replace(
    /<img\b([^>]*?)src=["'](.*?)["']([^>]*)>/gi,
    (_m, preAttrs, src, postAttrs) => {
      if (!ABSOLUTE_HTTPS.test(src)) {
        // Log de advertencia y omite la imagen si no es una URL absoluta HTTPS
        console.warn('[signature] Imagen ignorada en firma por no ser HTTPS absoluta:', src);
        return ''; // No incluir la etiqueta <img> si la URL no es válida
      }
      // Reconstruye la etiqueta <img> si la URL es válida
      return `<img ${preAttrs}src="${src}" ${postAttrs}>`;
    }
  );

  // Concatena el cuerpo del email con la firma saneada.
  return `${bodyHtml}\n<br>\n${safeSignatureHtml}`;
}
