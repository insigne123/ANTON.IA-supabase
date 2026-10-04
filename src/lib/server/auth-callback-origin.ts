/** App Hosting's request URL can be https://0.0.0.0:8080. Auth redirects
 * must use the configured public origin, never the container or Host headers. */
export function authCallbackOrigin(requestUrl: URL, environment: Record<string, string | undefined> = process.env) {
    const configured = [environment.CANONICAL_APP_URL, environment.NEXT_PUBLIC_BASE_URL, environment.NEXT_PUBLIC_APP_URL]
        .map(value => value?.trim()).find(Boolean);
    if (!configured && environment.NODE_ENV === 'production') throw new Error('AUTH_PUBLIC_ORIGIN_MISSING');
    const url = new URL(configured || requestUrl.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || ['0.0.0.0', '[::]'].includes(url.hostname)) throw new Error('AUTH_PUBLIC_ORIGIN_INVALID');
    return url.origin;
}
