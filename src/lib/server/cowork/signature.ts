import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/** No scripts, external images, stylesheets, forms, CSS URLs or remote fetches.
 * A deliberately small email-safe subset, identical at staging and preview. */
export function sanitizeCoworkSignature(html: string): { html: string; text: string } {
  const dom = new JSDOM('');
  try {
    const purify = createDOMPurify(dom.window);
    const clean = purify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'a', 'table', 'tbody', 'tr', 'td'],
      ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:|tel:)/i,
    });
    dom.window.document.body.innerHTML = clean;
    for (const element of dom.window.document.querySelectorAll('br,p,div,tr')) {
      element.appendChild(dom.window.document.createTextNode('\n'));
    }
    const text = dom.window.document.body.textContent?.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() || '';
    if (!text) throw new Error('La firma debe contener texto visible.');
    return { html: clean, text };
  } finally { dom.window.close(); }
}
