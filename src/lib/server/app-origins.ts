/**
 * The two addresses this app answers at (13 Nov 2026, docs/dominios.md). The app's own, where it is hosted, is the one Google,
 * Microsoft and the providers that call back know (CANONICAL_APP_URL and its siblings). The public one, APP_PUBLIC_URL, is the
 * address people know the product by (https://anton-ia.yago.cl): the links of the emails the app sends to its own users open there,
 * and whoever signs in there stays there.
 *
 * Nothing here trusts a request to say where it is: a request only picks between the addresses the server was configured with.
 */
type Env = Record<string, string | undefined>;
type Headers = { get(name: string): string | null };

/** A plain https origin (http only for localhost), or null: no path, no query, no credentials. */
export function plainOrigin(raw: unknown): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

/** The address people know the product by, when there is one. */
export const publicAppOrigin = (env: Env = process.env) => plainOrigin(env.APP_PUBLIC_URL);

/**
 * Where a link in one of the app's own emails opens: the public address, or the app's own (`appUrl`) without one. Not for what is
 * sent to prospects (unsubscribe, opens and clicks) nor for the addresses providers call back: those keep the app's own.
 */
export function appLinkBase(appUrl: string, env: Env = process.env): string {
  return publicAppOrigin(env) ?? appUrl.trim().replace(/\/$/, '');
}

/**
 * Which of the configured addresses a request came to: the public one when its host says so, else `canonical`. App Hosting ends
 * HTTPS before Next, so the request's own URL may be the container's; the host headers only choose between configured addresses.
 */
export function requestAppOrigin(headers: Headers, canonical: string, env: Env = process.env): string {
  const open = publicAppOrigin(env);
  if (!open || open === canonical) return canonical;
  const host = new URL(open).host;
  return [headers.get('x-forwarded-host'), headers.get('host')].some(value => String(value || '').split(',')[0].trim().toLowerCase() === host) ? open : canonical;
}
