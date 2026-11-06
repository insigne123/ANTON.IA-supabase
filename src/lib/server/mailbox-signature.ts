import { JSDOM } from 'jsdom';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { mailboxAccessToken } from '@/lib/server/reply-sync';
import {
  pickRecurringSignature, signatureContentIds, signatureFromSentHtml, withInlineImages, type ParseHtml,
} from '@/lib/email-studio/mailbox-signature';

export type MailboxSignature = {
  provider: 'gmail' | 'outlook';
  /** The signature as the person's mailbox has it, its images inline (`data:`) or on the web (`https:`); null when none was found. */
  html: string | null;
  reason?: 'not_connected' | 'not_found' | 'unavailable';
};

type Fetch = typeof fetch;
const parse: ParseHtml = html => new JSDOM(html).window.document;
/** The images an email carries are small; a bigger one is not a signature's and is left out. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Recent emails are enough: the signature is in every one the person writes. */
const SENT_TO_READ = 15;

async function gmailSignature(token: string, request: Fetch): Promise<string | null> {
  const response = await request('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) throw new Error(`gmail_send_as_${response.status}`);
  const data = await response.json() as { sendAs?: Array<{ isDefault?: boolean; isPrimary?: boolean; signature?: string }> };
  const entries = data.sendAs || [];
  const chosen = entries.find(entry => entry.isDefault) || entries.find(entry => entry.isPrimary) || entries[0];
  const html = String(chosen?.signature || '').trim();
  return html || null;
}

async function graph(token: string, path: string, request: Fetch) {
  const response = await request(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', Prefer: 'outlook.body-content-type="html"' }, cache: 'no-store',
  });
  if (!response.ok) throw new Error(`graph_${response.status}`);
  return response.json();
}

async function outlookSignature(token: string, request: Fetch): Promise<string | null> {
  const sent = await graph(token, `/me/mailFolders/SentItems/messages?$top=${SENT_TO_READ}&$orderby=sentDateTime desc&$select=id,body,hasAttachments`, request) as {
    value?: Array<{ id: string; hasAttachments?: boolean; body?: { contentType?: string; content?: string } }>;
  };
  const candidates = (sent.value || []).flatMap(message => {
    const body = String(message.body?.content || '');
    // What the app sent carries its own footer: the signature to keep is the one the person writes with in Outlook.
    if (!body || /\/unsubscribe\?/i.test(body)) return [];
    const html = signatureFromSentHtml(body, parse);
    return html ? [{ id: message.id, html }] : [];
  });
  const chosen = pickRecurringSignature(candidates, parse);
  if (!chosen) return null;
  const ids = signatureContentIds(chosen.html);
  if (!ids.length) return chosen.html;
  // The photo or logo goes attached to each email (cid:): its bytes come from that email, to be uploaded like a pasted one.
  const listed = await graph(token, `/me/messages/${encodeURIComponent(chosen.id)}/attachments?$select=id,contentId,contentType,size,isInline`, request) as {
    value?: Array<{ id: string; contentId?: string | null; contentType?: string | null; size?: number; isInline?: boolean }>;
  };
  const wanted = new Set(ids.map(id => id.replace(/^<|>$/g, '').toLowerCase()));
  const images = new Map<string, { contentType: string; base64: string }>();
  for (const attachment of listed.value || []) {
    const contentId = String(attachment.contentId || '').replace(/^<|>$/g, '');
    if (!contentId || !wanted.has(contentId.toLowerCase()) || Number(attachment.size || 0) > MAX_IMAGE_BYTES) continue;
    const full = await graph(token, `/me/messages/${encodeURIComponent(chosen.id)}/attachments/${encodeURIComponent(attachment.id)}`, request) as { contentBytes?: string; contentType?: string };
    const contentType = String(full.contentType || attachment.contentType || '');
    if (!full.contentBytes || !/^image\/(?:png|jpe?g|gif|webp)$/i.test(contentType)) continue;
    const original = ids.find(id => id.replace(/^<|>$/g, '').toLowerCase() === contentId.toLowerCase()) || contentId;
    images.set(original, { contentType: contentType.toLowerCase(), base64: full.contentBytes });
  }
  return withInlineImages(chosen.html, images);
}

/** The signature of the person's connected Gmail or Outlook, read with their own connection. */
export async function readMailboxSignature(userId: string, provider: 'gmail' | 'outlook', dependencies: {
  token?: (userId: string, provider: 'gmail' | 'outlook') => Promise<string | null>; request?: Fetch;
} = {}): Promise<MailboxSignature> {
  const request = dependencies.request || fetch;
  let token: string | null = null;
  try {
    token = await (dependencies.token || ((id, which) => mailboxAccessToken(getSupabaseAdminClient(), id, which)))(userId, provider);
  } catch {
    return { provider, html: null, reason: 'not_connected' };
  }
  if (!token) return { provider, html: null, reason: 'not_connected' };
  try {
    const html = provider === 'gmail' ? await gmailSignature(token, request) : await outlookSignature(token, request);
    return html ? { provider, html } : { provider, html: null, reason: 'not_found' };
  } catch (error) {
    console.warn('[mailbox-signature] read failed', { provider, reason: error instanceof Error ? error.message : 'unknown' });
    return { provider, html: null, reason: 'unavailable' };
  }
}
