import { requestAppOrigin } from '@/lib/server/app-origins';

/** App Hosting's request URL can be https://0.0.0.0:8080. Auth redirects
 * must use a configured public origin, never the container or Host headers.
 * With `headers`, a request that came to the public address (APP_PUBLIC_URL, app-origins.ts) stays there: its
 * session was just written for that address. The headers only choose between the configured addresses. */
export function authCallbackOrigin(requestUrl: URL, environment: Record<string, string | undefined> = process.env, headers?: { get(name: string): string | null }) {
    const configured = [environment.CANONICAL_APP_URL, environment.NEXT_PUBLIC_BASE_URL, environment.NEXT_PUBLIC_APP_URL]
        .map(value => value?.trim()).find(Boolean);
    if (!configured && environment.NODE_ENV === 'production') throw new Error('AUTH_PUBLIC_ORIGIN_MISSING');
    const url = new URL(configured || requestUrl.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || ['0.0.0.0', '[::]'].includes(url.hostname)) throw new Error('AUTH_PUBLIC_ORIGIN_INVALID');
    return headers ? requestAppOrigin(headers, url.origin, environment) : url.origin;
}
