export type PreparedOutboundEmail = {
  html: string;
  text: string;
  warnings: string[];
};

/** The person's email signature (Plan 11, PR 3a), already sanitized by the server. `separator: false` leaves out the
 * «-- » line before it in the plain-text version, as chosen in «Firmas y estilo». */
export type OutboundSignature = { html: string; text: string; separator?: boolean };
/** Marks the signature block, so a body prepared twice (the senders prepare again) never carries it twice. */
export const SIGNATURE_MARKER = 'data-anton-signature';

function escapeHtml(text: string) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function stripHtmlToText(html: string) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The closing words a signature may open with; they never count as the person's name. */
const SIGN_OFF = /^(?:saludos|un saludo|un abrazo|abrazos?|gracias|muchas gracias|atentamente|cordialmente|quedo atent|best|regards|kind regards|cheers)\b/;
const signKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/^[\s,.;:·|•–—-]+|[\s,.;:·|•–—-]+$/g, '');
const signParts = (line: string) => line.split(/\s+[|·•–—]\s+|\s*,\s+|\t+/).map(signKey).filter(Boolean);

/**
 * The body without its own closing block when the signature that follows already says it (9 Nov 2026, with the signature of
 * Outlook or Gmail on everyone's emails): «Camila Torres / Gerente comercial / Yago QA» above a signature with that name, title
 * and company would read twice. Only the last lines go, only when each one is in the signature and one of them is the name;
 * «Saludos,» and a first name alone («Camila») stay, as in an email written in Outlook.
 */
export function withoutRepeatedSignOff(body: string, signatureText: string): string {
  const signatureLines = signatureText.split('\n').map(line => line.trim()).filter(Boolean);
  const name = signatureLines.flatMap(signParts).find(part => !SIGN_OFF.test(part) && /\p{L}/u.test(part));
  if (!name) return body;
  const known = new Set(signatureLines.flatMap(line => [signKey(line), ...signParts(line)]));
  const nameWords = new Set(name.split(' '));
  // «Pedro Soto» is the name of a signature that says «Pedro Soto Rojas»; «Pedro» alone is a sign-off, not the name.
  const isName = (key: string) => key === name || (key.split(' ').length >= 2 && key.split(' ').every(word => nameWords.has(word)));
  const covered = (line: string) => {
    const key = signKey(line);
    if (!key) return false;
    if (known.has(key) || isName(key)) return true;
    const parts = signParts(line);
    return parts.length > 0 && parts.every(part => known.has(part) || isName(part));
  };
  const lines = body.replace(/\s+$/, '').split('\n');
  let end = lines.length;
  let removed = 0;
  let sawName = false;
  while (end > 0 && removed < 6) {
    const line = lines[end - 1];
    if (!line.trim()) { end -= 1; continue; }
    if (!covered(line)) break;
    if (isName(signKey(line)) || signParts(line).some(isName)) sawName = true;
    end -= 1;
    removed += 1;
  }
  if (!removed || !sawName) return body;
  let kept = lines.slice(0, end);
  // A signature that opens with its own «Saludos cordiales,» takes the place of the body's.
  if (SIGN_OFF.test(signKey(signatureLines[0] || ''))) {
    let last = kept.length;
    while (last > 0 && !kept[last - 1].trim()) last -= 1;
    if (last > 0 && kept[last - 1].trim().length <= 40 && SIGN_OFF.test(signKey(kept[last - 1]))) kept = kept.slice(0, last - 1);
  }
  const result = kept.join('\n').replace(/\s+$/, '');
  return result || body;
}

function textToHtml(text: string) {
  return `<div style="white-space:pre-wrap;line-height:1.55;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(text || '').replace(/\n/g, '<br>')}</div>`;
}

function looksLikeHtml(content: string) {
  return /<\/?[a-z][\s\S]*>/i.test(String(content || ''));
}

export function hasUnsubscribeContent(content: string) {
  const lowered = String(content || '').toLowerCase();
  return lowered.includes('/unsubscribe?') || lowered.includes('darte de baja') || lowered.includes('unsubscribe');
}

export function buildUnsubscribeFooterHtml(url: string) {
  return `
<br/><br/>
<div style="font-family:sans-serif;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:10px;margin-top:20px;display:block;line-height:1.5;">
  <p style="margin:0;">Si prefieres no recibir más correos comerciales de nosotros, responde a este mensaje indicándolo y dejaremos de contactarte por esta vía. También puedes <a href="${escapeHtml(url)}" target="_blank" style="color:#2563eb;text-decoration:underline;">darte de baja aquí</a>.</p>
</div>`;
}

export function buildUnsubscribeFooterText(url: string) {
  return `\n\n---\nSi prefieres no recibir más correos comerciales de nosotros, responde a este mensaje indicándolo y dejaremos de contactarte por esta vía. También puedes darte de baja aquí: ${url}`;
}

function normalizeOutboundText(value: string) {
  const text = String(value || '').trim();
  const lowered = text.toLowerCase();
  if (!text) return '';
  if (['null', 'undefined', 'n/a', 'none'].includes(lowered)) return '';
  return text;
}

function hasUnresolvedPlaceholder(value: string) {
  const text = String(value || '');
  if (!text) return false;
  if (/\{\{[^}]+\}\}/.test(text)) return true;
  return /\[\s*(?:nombre(?:\s+del\s+lead)?|lead\s+name|cargo(?:\s+del\s+lead)?|lead\s+title|empresa(?:\s+del\s+lead)?|lead\s+company|tu\s+nombre|mi\s+nombre|su\s+nombre|tu\s+cargo|mi\s+cargo|su\s+cargo|tu\s+compa(?:ñ|n)[ií]a|mi\s+compa(?:ñ|n)[ií]a|tu\s+empresa|mi\s+empresa|su\s+empresa|tu\s+correo(?:\s+electr[oó]nico)?|mi\s+correo(?:\s+electr[oó]nico)?|su\s+correo(?:\s+electr[oó]nico)?|tu\s+tel[eé]fono|mi\s+tel[eé]fono|su\s+tel[eé]fono|tu\s+sitio\s+web|mi\s+sitio\s+web|su\s+sitio\s+web)\s*\]/i.test(text);
}

export function prepareOutboundEmail(input: {
  html?: string;
  text?: string;
  unsubscribeUrl?: string | null;
  /** Goes right after the body and before the unsubscribe footer. */
  signature?: OutboundSignature | null;
}): PreparedOutboundEmail {
  const warnings: string[] = [];
  let html = String(input.html || '').trim();
  let text = String(input.text || '').trim();
  const unsubscribeUrl = String(input.unsubscribeUrl || '').trim();
  const signature = input.signature;
  const signatureText = signature && (signature.html || signature.text) ? (signature.text || stripHtmlToText(signature.html)).trim() : '';

  // A plain body (the AI's, a template's, a reply) loses its own closing block when the signature repeats it, before it becomes
  // HTML. A body written as HTML is left as it is, and so is one that already carries the signature (prepared twice).
  if (signatureText && (!html || !looksLikeHtml(html)) && !text.includes(signatureText) && !html.includes(SIGNATURE_MARKER)) {
    if (text) text = withoutRepeatedSignOff(text, signatureText);
    if (html) html = withoutRepeatedSignOff(html, signatureText);
  }

  if (html && !looksLikeHtml(html)) {
    if (!text) text = html;
    html = textToHtml(html);
    warnings.push('Email body was marked as HTML but looked like plain text; converted automatically.');
  }

  if (!html && text) html = textToHtml(text);
  if (!text && html) text = stripHtmlToText(html);
  if (!html && !text) {
    html = '<div></div>';
    text = '';
    warnings.push('Email body was empty; generated a minimal body.');
  }

  if (signature && (signature.html || signature.text) && !html.includes(SIGNATURE_MARKER)) {
    const block = `<div ${SIGNATURE_MARKER}="1" style="margin-top:16px;">${signature.html || textToHtml(signature.text)}</div>`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${block}</body>`);
    else html += block;
    if (signatureText && !text.includes(signatureText)) text += `\n\n${signature.separator === false ? '' : '-- \n'}${signatureText}`;
  }

  if (unsubscribeUrl) {
    if (!html.includes(escapeHtml(unsubscribeUrl))) {
      const footer = buildUnsubscribeFooterHtml(unsubscribeUrl);
      if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${footer}</body>`);
      else html += footer;
    } else if (!html.includes('responde a este mensaje indicándolo')) {
      html += '<p style="font-family:sans-serif;font-size:12px;color:#6b7280;">Si prefieres no recibir más correos comerciales de nosotros, responde a este mensaje indicándolo y dejaremos de contactarte por esta vía.</p>';
    }
    if (!text.includes(unsubscribeUrl)) {
      text += buildUnsubscribeFooterText(unsubscribeUrl);
    } else if (!text.includes('responde a este mensaje indicándolo')) {
      text += '\n\nSi prefieres no recibir más correos comerciales de nosotros, responde a este mensaje indicándolo y dejaremos de contactarte por esta vía.';
    }
  } else {
    warnings.push('No unsubscribe URL provided.');
  }

  const links = (html.match(/href=/gi) || []).length;
  if (links > 8) warnings.push('Email has many links; review deliverability.');
  if (String(text || '').length < 40) warnings.push('Email body is very short.');

  return { html, text: text.trim(), warnings };
}

export function validateOutboundEmail(input: {
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
  requireUnsubscribe?: boolean;
  unsubscribeUrl?: string | null;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const to = String(input.to || '').trim();
  const subject = normalizeOutboundText(String(input.subject || ''));
  const html = normalizeOutboundText(String(input.html || ''));
  const text = normalizeOutboundText(String(input.text || ''));
  const unsubscribeUrl = String(input.unsubscribeUrl || '').trim();
  const effectiveBodyText = normalizeOutboundText(text || stripHtmlToText(html));

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) errors.push('Invalid recipient email.');
  if (!subject) errors.push('Missing email subject.');
  if (!effectiveBodyText) errors.push('Missing email content.');
  if (hasUnresolvedPlaceholder(subject) || hasUnresolvedPlaceholder(html) || hasUnresolvedPlaceholder(text)) {
    errors.push('Email contains unresolved placeholders.');
  }
  if (subject.length > 180) warnings.push('Subject is unusually long.');
  if (input.requireUnsubscribe && !unsubscribeUrl) errors.push('Missing unsubscribe URL.');

  return { ok: errors.length === 0, errors, warnings };
}
