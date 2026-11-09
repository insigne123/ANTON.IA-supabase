/**
 * The signature a person already uses, read from their own mailbox (6 Nov 2026: a pasted Outlook signature lost its photo, which
 * Outlook keeps on the computer). Gmail keeps it in its settings; Outlook has no API for it, but every email the person sends from
 * Outlook carries it: the app reads it from their sent messages. Pure: it takes a parser, so the server (jsdom) and the tests share it.
 */

export type ParseHtml = (html: string) => Document;

/** Where each Outlook puts the signature it adds: Outlook on the web and the new Outlook, the phone app, and Word (desktop). */
const SIGNATURE_CONTAINERS = ['#Signature', '#signature', '[id^="ms-outlook-mobile-signature"]', '#ms-outlook-ios-signature', '.gmail_signature'];
/** What starts the quoted message of a reply or a forward: the signature ends before it. */
const QUOTE_STARTS = ['#appendonsend', '#divRplyFwdMsg', '#x_divRplyFwdMsg', '.gmail_quote', 'blockquote[type="cite"]', '#mail-editor-reference-message-container'];
const MAX_SIGNATURE_CHARS = 20_000;

const textOf = (node: Node | null | undefined) => String(node?.textContent || '').replace(/\s+/g, ' ').trim();

/**
 * What a phone or a mail app writes by itself under each email («Obtener Outlook para Android», «Enviado desde mi iPhone»): nobody's
 * signature (9 Nov 2026). Brought on its own, it would close every campaign email; someone who writes from the phone keeps the
 * signature of the emails they send from the computer.
 */
const APP_DEFAULT_SIGNATURE = /^(?:(?:get|obtener|obt[eé]n|descarga|descargar|download)\s+outlook\s+(?:for|para)\b|(?:sent|enviado)\s+(?:from|desde)\s+(?:my|mi|outlook|correo|mail|yahoo)\b)/i;
export const isAppDefaultSignature = (text: string) => text.trim().length <= 80 && APP_DEFAULT_SIGNATURE.test(text.trim());

/** The signature of one sent email, or null: the block Outlook marks, or from Word's «_MailAutoSig» bookmark to the quoted message. */
export function signatureFromSentHtml(html: string, parse: ParseHtml): string | null {
  if (!html || !/<[a-z]/i.test(html)) return null;
  const doc = parse(html);
  for (const quote of QUOTE_STARTS.flatMap(selector => [...doc.querySelectorAll(selector)])) {
    // Everything from the quoted message on belongs to someone else's email.
    let node: ChildNode | null = quote;
    while (node) { const next: ChildNode | null = node.nextSibling; node.remove(); node = next; }
  }
  for (const selector of SIGNATURE_CONTAINERS) {
    const found = doc.querySelector(selector);
    if (!found) continue;
    const hasImage = Boolean(found.querySelector('img'));
    if (!hasImage && isAppDefaultSignature(textOf(found))) continue;
    if (textOf(found) || hasImage) return found.innerHTML.trim().slice(0, MAX_SIGNATURE_CHARS) || null;
  }
  const bookmark = doc.querySelector('a[name="_MailAutoSig"]');
  if (bookmark) {
    // The paragraph that holds the bookmark and every block after it, up to the end of what this person wrote.
    let start: Element | null = bookmark;
    while (start?.parentElement && start.parentElement !== doc.body && !/^(?:DIV|BODY)$/.test(start.parentElement.tagName)) start = start.parentElement;
    const blocks: string[] = [];
    for (let node: Element | null = start; node; node = node.nextElementSibling) blocks.push(node.outerHTML);
    const joined = blocks.join('').trim();
    return joined ? joined.slice(0, MAX_SIGNATURE_CHARS) : null;
  }
  return null;
}

/** A signature's identity: its words and its images' names, so the same signature in several emails counts once. */
export function signatureKey(html: string, parse: ParseHtml) {
  const doc = parse(`<body>${html}</body>`);
  const images = [...doc.querySelectorAll('img')].map(image => String(image.getAttribute('src') || '').replace(/^cid:([^@]+).*$/i, 'cid:$1').slice(0, 80));
  return `${textOf(doc.body).toLowerCase()}|${images.join(',')}`;
}

/** The signature most of the recent emails carry (a one-off is someone's exception), with the email it came from. */
export function pickRecurringSignature<T extends { html: string }>(candidates: T[], parse: ParseHtml): T | null {
  const counts = new Map<string, { item: T; count: number }>();
  for (const candidate of candidates) {
    const key = signatureKey(candidate.html, parse);
    const entry = counts.get(key);
    if (entry) entry.count += 1; else counts.set(key, { item: candidate, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.item ?? null;
}

/** The inline images a signature points to by `cid:` (what Outlook attaches to each email). */
export function signatureContentIds(html: string) {
  return [...new Set([...html.matchAll(/src=["']cid:([^"']+)["']/gi)].map(match => match[1].trim()).filter(Boolean))];
}

/** The signature with each `cid:` image replaced by its bytes, so the app can upload it as it does with a pasted one. */
export function withInlineImages(html: string, images: Map<string, { contentType: string; base64: string }>) {
  return html.replace(/src=(["'])cid:([^"']+)\1/gi, (whole, quote: string, id: string) => {
    const image = images.get(id.trim());
    return image ? `src=${quote}data:${image.contentType};base64,${image.base64}${quote}` : whole;
  });
}
