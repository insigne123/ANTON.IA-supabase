import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The way into a «Contacto del día» from the person's inbox, without signing in (13 Nov 2026, docs/contacto-del-dia.md): the emails
 * of a drop of several contacts carry a link that only this server could have written, for that drop alone, good for two weeks.
 * Whoever opens it sees that drop's contacts and can act on them as the person (look an email up, change the emails, approve the
 * campaign), so it is worth what the email is worth: it names one drop, it expires, and opening it does nothing by itself (every
 * action is a button on the page, never the link, since mail scanners follow links).
 *
 * The link is 36 bytes in base64url: the drop's id, the second it expires, and the first 16 bytes of their HMAC-SHA256 under a key
 * of its own, derived from the server's secret, so it is never valid as any other signature made with that secret.
 */
export const DROP_LINK_DAYS = 14;
type Env = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{48}$/;

function key(env: Env) {
  const secret = [env.LEAD_DROPS_LINK_SECRET, env.INTERNAL_API_SECRET, env.SUPABASE_SERVICE_ROLE_KEY].map(value => String(value || '').trim()).find(Boolean);
  return secret ? createHmac('sha256', secret).update('lead-drop-link:v1').digest() : null;
}
const seal = (secret: Buffer, body: Buffer) => createHmac('sha256', secret).update(body).digest().subarray(0, 16);

/** The link's token for a drop, or null when the server has no secret to sign with (the emails then link to the app, as before). */
export function signDropLink(dropId: string, options: { now?: Date; env?: Env; days?: number } = {}): string | null {
  const secret = key(options.env ?? process.env);
  if (!secret || !UUID.test(dropId)) return null;
  const body = Buffer.alloc(20);
  Buffer.from(dropId.replace(/-/g, ''), 'hex').copy(body, 0);
  body.writeUInt32BE(Math.floor((options.now ?? new Date()).getTime() / 1000) + (options.days ?? DROP_LINK_DAYS) * 86_400, 16);
  return Buffer.concat([body, seal(secret, body)]).toString('base64url');
}

/** The drop a token names and until when; 'expired' when it was ours but its time passed; null for anything else. */
export function readDropLink(token: unknown, options: { now?: Date; env?: Env } = {}): { dropId: string; expiresAt: Date } | 'expired' | null {
  const secret = key(options.env ?? process.env);
  if (!secret || typeof token !== 'string' || !TOKEN.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== 36) return null;
  const body = raw.subarray(0, 20);
  if (!timingSafeEqual(raw.subarray(20), seal(secret, body))) return null;
  const expiresAt = new Date(body.readUInt32BE(16) * 1000);
  if (expiresAt.getTime() <= (options.now ?? new Date()).getTime()) return 'expired';
  const hex = body.subarray(0, 16).toString('hex');
  return { dropId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`, expiresAt };
}

/** The page a token opens: outside the app, with nothing to sign in to (src/app/contactos/[token]). */
export const dropLinkHref = (token: string) => `/contactos/${token}`;

/**
 * Where the link opens: the address people know the product by (LEAD_DROPS_PUBLIC_URL, https://anton-ia.yago.cl since 13 Nov 2026),
 * which serves this same app; without it, or with something that is not a plain https address, the app's own. Only the way into a
 * drop from an email uses it: the rest of the app keeps its address, where its sessions and its mailbox consents live.
 */
export function dropLinkBase(appUrl: string, env: Env = process.env): string {
  const own = appUrl.replace(/\/$/, '');
  const raw = String(env.LEAD_DROPS_PUBLIC_URL || '').trim();
  if (!raw) return own;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return own;
    return url.origin;
  } catch { return own; }
}

/** The full address for an email, or null without a secret. */
export function dropLinkUrl(appUrl: string, dropId: string, options: { now?: Date; env?: Env } = {}): string | null {
  const token = signDropLink(dropId, options);
  return token ? `${dropLinkBase(appUrl, options.env)}${dropLinkHref(token)}` : null;
}
