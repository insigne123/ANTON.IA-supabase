const BLOCKED_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'meta',
  'base',
  'link',
];

function escapeHtml(text: string) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fallbackSanitize(input: string) {
  const stripped = String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `<div style="white-space:pre-wrap;line-height:1.55;">${escapeHtml(stripped || '(Sin contenido)')}</div>`;
}

function isSafeHref(value: string) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('#')) return true;
  try {
    const u = new URL(v, 'https://example.com');
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol);
  } catch {
    return false;
  }
}

function isSafeSrc(value: string) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('cid:')) return true;
  if (/^data:image\//i.test(v)) return true;
  try {
    const u = new URL(v, 'https://example.com');
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

export function sanitizeReplyHtml(input: string) {
  if (!input) return '<div>(Sin contenido)</div>';

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return fallbackSanitize(input);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, 'text/html');

  doc.querySelectorAll(BLOCKED_TAGS.join(',')).forEach((el) => el.remove());

  doc.querySelectorAll('*').forEach((el) => {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      const value = attr.value;

      if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'formaction' || name === 'xlink:href') {
        el.removeAttribute(attr.name);
        continue;
      }

      if (name === 'href') {
        if (!isSafeHref(value)) {
          el.removeAttribute('href');
        } else {
          el.setAttribute('rel', 'noopener noreferrer nofollow');
          if (!el.getAttribute('target')) el.setAttribute('target', '_blank');
        }
      }

      if (name === 'src' && !isSafeSrc(value)) {
        el.removeAttribute('src');
      }
    }
  });

  const cleaned = doc.body.innerHTML?.trim();
  return cleaned || '<div>(Sin contenido)</div>';
}
