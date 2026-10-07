import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import type { OutboundSignature } from '@/lib/email-outbound';
import { SIGNATURE_MAX_HTML } from '@/lib/email-studio/signature-builder';
import {
  SIGNATURE_ALLOWED_ATTR, SIGNATURE_ALLOWED_TAGS, SIGNATURE_URI, SIGNATURE_URI_SAFE_ATTR,
} from '@/lib/email-studio/signature-import';

/**
 * The signature the person set in «Firmas y estilo», added to every email the server sends for them (Plan 11, PR 3a):
 * Redactar, campaigns, automatic follow-ups, Cowork and replies in the thread. Until now it was saved but never sent.
 * It lives in `profiles.signatures[gmail|outlook]` as `{ enabled, html, text }`; the one of the mailbox that sends is used.
 * Reading it never stops a send: without a signature, or when it cannot be read, the email goes as before.
 */
export type SignatureChannel = 'gmail' | 'outlook';

export const signatureChannelFor = (provider: string | null | undefined): SignatureChannel =>
  (/^(google|gmail)$/i.test(String(provider || '').trim()) ? 'gmail' : 'outlook');

/**
 * An email-safe copy of the stored HTML: text, links, tables and images over https (the uploaded signature image lives in
 * public storage). No scripts, forms, event handlers, embedded data or CSS that loads anything.
 */
export function sanitizeSendSignature(html: string | null | undefined, text?: string | null): OutboundSignature | null {
  const raw = String(html || '').slice(0, SIGNATURE_MAX_HTML).trim();
  const plain = String(text || '').trim();
  if (!raw && !plain) return null;
  const dom = new JSDOM('');
  try {
    const purify = createDOMPurify(dom.window as unknown as Parameters<typeof createDOMPurify>[0]);
    purify.addHook('uponSanitizeAttribute', (_node, data) => {
      if (data.attrName === 'style' && /url\s*\(|expression\s*\(|@import|javascript:/i.test(data.attrValue)) data.keepAttr = false;
    });
    const clean = raw ? purify.sanitize(raw, {
      // The same rules as «Tu firma actual» when it is pasted (signature-import.ts), so the preview is what goes out.
      ALLOWED_TAGS: SIGNATURE_ALLOWED_TAGS, ALLOWED_ATTR: SIGNATURE_ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
      ALLOWED_URI_REGEXP: SIGNATURE_URI, ADD_URI_SAFE_ATTR: SIGNATURE_URI_SAFE_ATTR,
    }) : '';
    dom.window.document.body.innerHTML = clean;
    const visible = dom.window.document.body.textContent?.replace(/\s+/g, ' ').trim() || '';
    const hasImage = Boolean(dom.window.document.body.querySelector('img[src]'));
    if (!visible && !hasImage) return plain ? { html: '', text: plain } : null;
    for (const element of dom.window.document.querySelectorAll('br,p,div,tr')) element.appendChild(dom.window.document.createTextNode('\n'));
    const derived = dom.window.document.body.textContent?.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() || '';
    return { html: clean, text: plain || derived };
  } finally {
    dom.window.close();
  }
}

type ProfilesReader = { from(table: 'profiles'): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } };

/** The enabled signature of the mailbox that sends, ready for prepareOutboundEmail; null when there is none. */
export async function readSendSignature(client: unknown, userId: string, provider: string | null | undefined): Promise<OutboundSignature | null> {
  try {
    const { data, error } = await (client as ProfilesReader).from('profiles').select('signatures').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    const stored = (data as { signatures?: unknown }).signatures;
    const config = stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[signatureChannelFor(provider)] : null;
    if (!config || typeof config !== 'object') return null;
    const { enabled, html, text, separatorPlaintext } = config as { enabled?: unknown; html?: unknown; text?: unknown; separatorPlaintext?: unknown };
    // Same reading as the screen: only a signature with «Usar al enviar» on goes out.
    if (enabled !== true) return null;
    const signature = sanitizeSendSignature(typeof html === 'string' ? html : '', typeof text === 'string' ? text : '');
    return signature && separatorPlaintext === false ? { ...signature, separator: false } : signature;
  } catch {
    return null;
  }
}
