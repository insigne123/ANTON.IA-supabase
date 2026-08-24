export type PreparedOutboundEmail = {
  html: string;
  text: string;
  warnings: string[];
};

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
  <p style="margin:0;">Si no deseas recibir más correos de nosotros, puedes <a href="${url}" target="_blank" style="color:#2563eb;text-decoration:underline;">darte de baja aquí</a>.</p>
</div>`;
}

export function buildUnsubscribeFooterText(url: string) {
  return `\n\n---\nSi no deseas recibir más correos de nosotros, puedes darte de baja aquí: ${url}`;
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
}): PreparedOutboundEmail {
  const warnings: string[] = [];
  let html = String(input.html || '').trim();
  let text = String(input.text || '').trim();
  const unsubscribeUrl = String(input.unsubscribeUrl || '').trim();

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

  if (unsubscribeUrl) {
    if (!hasUnsubscribeContent(html)) {
      const footer = buildUnsubscribeFooterHtml(unsubscribeUrl);
      if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${footer}</body>`);
      else html += footer;
    }
    if (!hasUnsubscribeContent(text)) {
      text += buildUnsubscribeFooterText(unsubscribeUrl);
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
